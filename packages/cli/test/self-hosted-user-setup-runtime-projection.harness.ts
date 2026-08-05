import { setTimeout as sleep } from 'node:timers/promises';
import {
  deploymentInspectResponseSchema,
  type DeploymentInspectResponse,
  type DeploymentInspectTarget,
} from '@compartment/contracts';
import type { SelfHostedUserSetupCli } from './self-hosted-user-setup-cli.harness';
import {
  expectSuccessfulCommand,
  runCommand,
  type SelfHostedUserSetupCommandResult,
} from './self-hosted-user-setup-command.harness';
import { readK3dPlatformSeed, type K3dPlatformSeed } from './self-hosted-user-setup-k3d.harness';

interface K3dPodCondition {
  readonly status?: string | undefined;
  readonly type?: string | undefined;
}

interface K3dPodContainer {
  readonly image?: string | undefined;
}

interface K3dPodList {
  readonly items?: K3dPod[] | undefined;
}

interface K3dPod {
  readonly metadata?: K3dPodMetadata | undefined;
  readonly spec?: K3dPodSpec | undefined;
  readonly status?: K3dPodStatus | undefined;
}

interface K3dPodMetadata {
  readonly deletionTimestamp?: string | undefined;
  readonly name?: string | undefined;
  readonly namespace?: string | undefined;
}

interface K3dPodSpec {
  readonly containers?: K3dPodContainer[] | undefined;
}

interface K3dPodStatus {
  readonly conditions?: K3dPodCondition[] | undefined;
  readonly phase?: string | undefined;
}

interface RuntimeImageObservation {
  readonly imageRef: string | null;
  readonly state: string;
}

const runtimeProjectionTimeoutMs: number = 180_000;
const runtimeProjectionPollDelayMs: number = 2_000;
const kubectlCommandTimeoutMs: number = 8 * 60_000;

export async function expectDeploymentRuntimeImageProjection(
  cli: SelfHostedUserSetupCli,
  projectName: string,
  serviceName: string,
  deploymentId: string,
): Promise<void> {
  const deadline: number = Date.now() + runtimeProjectionTimeoutMs;
  const expectedImageRef: string = await waitForReadyPodImageRef(deploymentId, deadline);
  requireCanonicalRuntimeImageRef(expectedImageRef);
  await waitForInspectImageRef(cli, projectName, serviceName, deploymentId, expectedImageRef, deadline);
  process.stdout.write(`Verified deployment ${deploymentId} runtime projection at exact image ${expectedImageRef}.\n`);
}

async function waitForReadyPodImageRef(deploymentId: string, deadline: number): Promise<string> {
  const seed: K3dPlatformSeed = readK3dPlatformSeed();
  let observation: RuntimeImageObservation = await readPodImageObservation(seed, deploymentId, deadline);
  for (;;) {
    if (observation.imageRef !== null) {
      return observation.imageRef;
    }
    if (Date.now() >= deadline) {
      break;
    }
    await sleepWithinDeadline(deadline);
    observation = await readPodImageObservation(seed, deploymentId, deadline);
  }
  throw new Error(
    `Timed out waiting for Ready runtime pods for deployment ${deploymentId}. Last state: ${observation.state}.`,
  );
}

async function readPodImageObservation(
  seed: K3dPlatformSeed,
  deploymentId: string,
  deadline: number,
): Promise<RuntimeImageObservation> {
  const result: SelfHostedUserSetupCommandResult = await runCommand({
    argv: [
      'kubectl',
      '--context',
      seed.kubeContext,
      'get',
      'pods',
      '--all-namespaces',
      '--selector',
      `compartment.dev/deployment-id=${deploymentId}`,
      '--output=json',
    ],
    timeoutMs: requireRemainingTimeout(deadline),
  });
  expectSuccessfulCommand(result, `read runtime pods for deployment ${deploymentId}`, '');
  const podList: K3dPodList = JSON.parse(result.stdout) as K3dPodList;
  if (!Array.isArray(podList.items)) {
    throw new Error(`Expected kubectl to return a pod list for deployment ${deploymentId}.`);
  }
  const pods: K3dPod[] = podList.items.filter((pod: K3dPod): boolean => pod.metadata?.deletionTimestamp === undefined);
  if (pods.length === 0) {
    return { imageRef: null, state: 'no non-terminating pods' };
  }
  if (pods.some((pod: K3dPod): boolean => !isPodRunningAndReady(pod))) {
    return { imageRef: null, state: `pods not ready: ${describePods(pods)}` };
  }
  const imageRefs: string[] = pods.map((pod: K3dPod): string => requireSinglePodImageRef(pod, deploymentId));
  const uniqueImageRefs: Set<string> = new Set<string>(imageRefs);
  if (uniqueImageRefs.size !== 1 || imageRefs[0] === undefined) {
    throw new Error(
      `Expected Ready pods for deployment ${deploymentId} to use one image ref, received ${JSON.stringify(imageRefs)}.`,
    );
  }
  return { imageRef: imageRefs[0], state: 'ready' };
}

async function waitForInspectImageRef(
  cli: SelfHostedUserSetupCli,
  projectName: string,
  serviceName: string,
  deploymentId: string,
  expectedImageRef: string,
  deadline: number,
): Promise<void> {
  let lastObservation: RuntimeImageObservation = { imageRef: null, state: 'deployment absent' };
  do {
    const inspect: DeploymentInspectResponse = await cli.runJson(
      `inspect --project ${projectName}`,
      deploymentInspectResponseSchema,
      { timeoutMs: requireRemainingTimeout(deadline) },
    );
    lastObservation = readInspectImageObservation(inspect, projectName, serviceName, deploymentId);
    if (lastObservation.imageRef === expectedImageRef) {
      return;
    }
    await sleepWithinDeadline(deadline);
  } while (Date.now() < deadline);
  throw new Error(
    `Timed out waiting for ${projectName}/${serviceName} deployment ${deploymentId} to expose runtime image ${expectedImageRef}. Last projection state: ${lastObservation.state}. Last observed image: ${lastObservation.imageRef ?? 'none'}.`,
  );
}

function readInspectImageObservation(
  inspect: DeploymentInspectResponse,
  projectName: string,
  serviceName: string,
  deploymentId: string,
): RuntimeImageObservation {
  const deployments: DeploymentInspectTarget[] = inspect.deployments.filter(
    (deployment: DeploymentInspectTarget): boolean =>
      deployment.id === deploymentId && deployment.serviceName === serviceName,
  );
  if (deployments.length > 1) {
    throw new Error(
      `Expected at most one inspected deployment for ${projectName}/${serviceName} with id ${deploymentId}, received ${deployments.length.toString()}.`,
    );
  }
  const deployment: DeploymentInspectTarget | undefined = deployments[0];
  if (deployment === undefined) {
    return { imageRef: null, state: 'deployment absent' };
  }
  if (deployment.runtime === null) {
    return { imageRef: null, state: 'runtime absent' };
  }
  requireCanonicalRuntimeImageRef(deployment.runtime.imageRef);
  return { imageRef: deployment.runtime.imageRef, state: 'runtime image mismatch' };
}

function isPodRunningAndReady(pod: K3dPod): boolean {
  return (
    pod.status?.phase === 'Running' &&
    pod.status.conditions?.some(
      (condition: K3dPodCondition): boolean => condition.type === 'Ready' && condition.status === 'True',
    ) === true
  );
}

function requireSinglePodImageRef(pod: K3dPod, deploymentId: string): string {
  const containers: K3dPodContainer[] | undefined = pod.spec?.containers;
  if (containers?.length !== 1 || containers[0]?.image === undefined) {
    throw new Error(
      `Expected Ready pod ${pod.metadata?.namespace ?? 'unknown'}/${pod.metadata?.name ?? 'unknown'} for deployment ${deploymentId} to contain exactly one application image.`,
    );
  }
  return containers[0].image;
}

function requireCanonicalRuntimeImageRef(imageRef: string): void {
  if (!/^[^@]+@sha256:[a-f0-9]{64}$/u.test(imageRef)) {
    throw new Error(`Expected a canonical digest-pinned rollback image ref, received ${imageRef}.`);
  }
}

function requireRemainingTimeout(deadline: number): number {
  return Math.min(kubectlCommandTimeoutMs, Math.max(1, deadline - Date.now()));
}

async function sleepWithinDeadline(deadline: number): Promise<void> {
  const remainingDelayMs: number = deadline - Date.now();
  if (remainingDelayMs > 0) {
    await sleep(Math.min(runtimeProjectionPollDelayMs, remainingDelayMs));
  }
}

function describePods(pods: readonly K3dPod[]): string {
  return JSON.stringify(
    pods.map((pod: K3dPod): readonly [string, string | undefined, boolean] => [
      `${pod.metadata?.namespace ?? 'unknown'}/${pod.metadata?.name ?? 'unknown'}`,
      pod.status?.phase,
      isPodRunningAndReady(pod),
    ]),
  );
}
