import type { RegistryInstallVerificationOutput } from '@compartment/contracts';
import { runCommandWithInput, runCommandWithTimeout } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import { buildKubectlCommand, formatKubernetesCommandFailure } from './kubernetes-command.support';
import type { KubernetesInstallDeploymentInput, KubernetesInstallState } from './kubernetes-install.service.types';
import type {
  KubernetesRegistryAcceptanceContainerStatus,
  KubernetesRegistryAcceptanceEvent,
  KubernetesRegistryAcceptanceEventList,
  KubernetesRegistryAcceptancePod,
} from './kubernetes-install-registry-verification.service.types';
import { readReadyKubernetesNodeNames } from './kubernetes-ready-nodes.service';
import {
  assertRegistryServiceAddress,
  readRegistryServiceAddresses,
} from './kubernetes-install-registry-service.service';
import { boundRegistryDiagnostic, readRegistryDiagnosticFailure } from './kubernetes-install-registry-diagnostics';

const verificationTimeoutMs: number = 5 * 60_000;
const verificationSecretName: string = 'compartment-registry-acceptance';

export async function verifyKubernetesInstallRegistryNodePull(
  input: KubernetesInstallDeploymentInput,
  registry: Pick<KubernetesInstallState, 'registryHostname' | 'registryIssuerRef'>,
): Promise<void> {
  const verification: RegistryInstallVerificationOutput = await pushRegistryAcceptanceImage(input);
  const nodes: string[] = await readReadyKubernetesNodeNames(input);
  if (nodes.length === 0) {
    throw new Error('Registry node-pull verification found no eligible Ready nodes.');
  }
  const podNames: string[] = nodes.map(
    (_node: string, index: number): string => `registry-acceptance-${index.toString()}`,
  );
  const serviceAddresses: string[] = await readRegistryServiceAddresses(input);
  assertRegistryServiceAddress(registry.registryHostname, serviceAddresses);
  await runNodePullVerification(input, registry, verification, nodes, podNames);
}

async function runNodePullVerification(
  input: KubernetesInstallDeploymentInput,
  registry: Pick<KubernetesInstallState, 'registryHostname' | 'registryIssuerRef'>,
  verification: RegistryInstallVerificationOutput,
  nodes: readonly string[],
  podNames: string[],
): Promise<void> {
  let verificationFailure: Error | null = null;
  try {
    await applyVerificationSecret(input, verification.dockerConfigJson);
    for (let index: number = 0; index < nodes.length; index += 1) {
      await applyVerificationPod(input, podNames[index]!, nodes[index]!, verification.imageRef);
      await waitForVerificationPod(input, registry, podNames[index]!, nodes[index]!);
    }
  } catch (error) {
    verificationFailure = error instanceof Error ? error : new Error('Registry node-pull verification failed.');
    throw verificationFailure;
  } finally {
    await deleteVerificationObjects(input, podNames, verificationFailure);
  }
}

async function pushRegistryAcceptanceImage(
  input: KubernetesInstallDeploymentInput,
): Promise<RegistryInstallVerificationOutput> {
  const result: CommandResult = await runCommandWithTimeout(
    buildKubectlCommand(input, [
      'exec',
      `deployment/${input.releaseName}-compartment-worker`,
      '--',
      'node',
      'dist/registry-install-verifier.js',
    ]),
    verificationTimeoutMs,
  );
  if (result.exitCode !== 0) {
    throw new Error(formatKubernetesCommandFailure('Registry acceptance image push failed', result));
  }
  try {
    const output: Partial<RegistryInstallVerificationOutput> | null = JSON.parse(
      result.stdout.trim(),
    ) as Partial<RegistryInstallVerificationOutput> | null;
    return requireVerificationOutput(output);
  } catch {
    throw new Error('Registry acceptance image push returned invalid output.');
  }
}

function requireVerificationOutput(
  output: Partial<RegistryInstallVerificationOutput> | null,
): RegistryInstallVerificationOutput {
  if (output === null || typeof output.dockerConfigJson !== 'string' || typeof output.imageRef !== 'string') {
    throw new Error('Invalid registry acceptance output.');
  }
  return { dockerConfigJson: output.dockerConfigJson, imageRef: output.imageRef };
}

async function applyVerificationSecret(
  input: KubernetesInstallDeploymentInput,
  dockerConfigJson: string,
): Promise<void> {
  await runRequiredInputCommand(
    buildKubectlCommand(input, ['apply', '--filename', '-']),
    JSON.stringify({
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name: verificationSecretName, namespace: input.namespace },
      stringData: { '.dockerconfigjson': dockerConfigJson },
      type: 'kubernetes.io/dockerconfigjson',
    }),
    'Registry acceptance pull Secret creation failed',
  );
}

async function applyVerificationPod(
  input: KubernetesInstallDeploymentInput,
  podName: string,
  nodeName: string,
  imageRef: string,
): Promise<void> {
  await runRequiredInputCommand(
    buildKubectlCommand(input, ['apply', '--filename', '-']),
    JSON.stringify({
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { name: podName, namespace: input.namespace },
      spec: {
        automountServiceAccountToken: false,
        containers: [{ image: imageRef, imagePullPolicy: 'Always', name: 'acceptance' }],
        imagePullSecrets: [{ name: verificationSecretName }],
        nodeName,
        restartPolicy: 'Never',
      },
    }),
    `Registry acceptance Pod creation failed on node ${nodeName}`,
  );
}

async function waitForVerificationPod(
  input: KubernetesInstallDeploymentInput,
  registry: Pick<KubernetesInstallState, 'registryHostname' | 'registryIssuerRef'>,
  podName: string,
  nodeName: string,
): Promise<void> {
  const result: CommandResult = await runCommandWithTimeout(
    buildKubectlCommand(input, ['wait', `pod/${podName}`, '--for=condition=Ready', '--timeout=180s']),
    verificationTimeoutMs,
  );
  if (result.exitCode !== 0) {
    const diagnostics: string = await readVerificationPodDiagnostics(input, podName);
    const message: string = `${formatKubernetesCommandFailure(
      `Registry node pull failed on ${nodeName}`,
      result,
    )}\n${diagnostics}\nRegistry prerequisites: the retained Service address ${registry.registryHostname} must be reachable from the node, and the TLS certificate issued by ${registry.registryIssuerRef.kind}/${registry.registryIssuerRef.name} with that IP SAN must be trusted by the node container runtime. Install a private CA before starting the runtime; if it was added later, restart the runtime (k3s server: systemctl restart k3s; k3s agent: systemctl restart k3s-agent).`;
    throw new Error(message);
  }
}

async function readVerificationPodDiagnostics(
  input: KubernetesInstallDeploymentInput,
  podName: string,
): Promise<string> {
  const podResult: CommandResult = await runCommandWithTimeout(
    buildKubectlCommand(input, ['get', `pod/${podName}`, '--namespace', input.namespace, '-o=json']),
    30_000,
  );
  const eventResult: CommandResult = await runCommandWithTimeout(
    buildKubectlCommand(input, [
      'get',
      'events',
      '--namespace',
      input.namespace,
      '--field-selector',
      `involvedObject.kind=Pod,involvedObject.name=${podName}`,
      '-o=json',
    ]),
    30_000,
  );
  return formatVerificationDiagnostics(podResult, eventResult);
}

function formatVerificationDiagnostics(podResult: CommandResult, eventResult: CommandResult): string {
  const waiting: string[] = readWaitingDiagnostics(podResult);
  const events: string[] = readEventDiagnostics(eventResult);
  const details: string[] = [...new Set([...waiting, ...events])].slice(0, 6);
  return details.length === 0
    ? 'Acceptance Pod diagnostics were unavailable.'
    : `Acceptance Pod diagnostics: ${details.join(' | ')}`;
}

function readWaitingDiagnostics(result: CommandResult): string[] {
  if (result.exitCode !== 0) {
    return [`Pod status unavailable: ${readRegistryDiagnosticFailure(result.exitCode, result.stderr, result.stdout)}`];
  }
  try {
    const pod: KubernetesRegistryAcceptancePod = JSON.parse(result.stdout) as KubernetesRegistryAcceptancePod;
    return (pod.status?.containerStatuses ?? [])
      .map((status: KubernetesRegistryAcceptanceContainerStatus): string | undefined => {
        const reason: string | undefined = status.state?.waiting?.reason;
        if (reason === undefined) {
          return undefined;
        }
        const message: string | undefined = status.state?.waiting?.message;
        return `waiting reason ${reason}${message === undefined || message === '' ? '' : `: ${boundRegistryDiagnostic(message)}`}`;
      })
      .filter((detail: string | undefined): detail is string => detail !== undefined);
  } catch {
    return ['Pod status returned invalid JSON.'];
  }
}

function readEventDiagnostics(result: CommandResult): string[] {
  if (result.exitCode !== 0) {
    return [`Pod events unavailable: ${readRegistryDiagnosticFailure(result.exitCode, result.stderr, result.stdout)}`];
  }
  try {
    const events: KubernetesRegistryAcceptanceEventList = JSON.parse(
      result.stdout,
    ) as KubernetesRegistryAcceptanceEventList;
    return events.items
      .slice(-5)
      .map((event: KubernetesRegistryAcceptanceEvent): string | undefined => {
        const message: string | undefined = event.message;
        if (message === undefined || message === '') {
          return undefined;
        }
        return `${event.reason ?? 'Event'}: ${boundRegistryDiagnostic(message)}`;
      })
      .filter((detail: string | undefined): detail is string => detail !== undefined);
  } catch {
    return ['Pod events returned invalid JSON.'];
  }
}

async function runRequiredInputCommand(command: string[], manifest: string, message: string): Promise<void> {
  const result: CommandResult = await runCommandWithInput(command, manifest);
  if (result.exitCode !== 0) {
    throw new Error(formatKubernetesCommandFailure(message, result));
  }
}

async function deleteVerificationObjects(
  input: KubernetesInstallDeploymentInput,
  podNames: string[],
  primaryFailure: Error | null,
): Promise<void> {
  const result: CommandResult = await runCommandWithTimeout(
    buildKubectlCommand(input, [
      'delete',
      ...podNames.map((podName: string): string => `pod/${podName}`),
      `secret/${verificationSecretName}`,
      '--ignore-not-found',
      '--wait=false',
    ]),
    30_000,
  );
  if (result.exitCode !== 0) {
    const cleanupFailure: string = formatKubernetesCommandFailure('Registry acceptance cleanup failed', result);
    if (primaryFailure !== null) {
      primaryFailure.message = `${primaryFailure.message}\n${cleanupFailure}`;
      return;
    }
    throw new Error(cleanupFailure);
  }
}
