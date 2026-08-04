import { randomUUID } from 'node:crypto';
import { runCommand, runCommandWithInput, runCommandWithTimeout } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import { buildKubectlCommand, formatKubernetesCommandFailure } from './kubernetes-command.support';
import type {
  KubernetesSandboxRuntimePreflightInput,
  KubernetesSandboxRuntimeVerification,
} from './kubernetes-sandbox-runtime-preflight.service.types';
import { readReadyKubernetesNodeNames } from './kubernetes-ready-nodes.service';

const canaryImage: string =
  'postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777';
const canaryTimeoutMs: number = 5 * 60_000;

export async function verifyKubernetesSandboxRuntime(
  input: KubernetesSandboxRuntimePreflightInput,
): Promise<KubernetesSandboxRuntimeVerification> {
  assertConfiguredRuntimeClassName(input.runtimeClassName);
  await assertRuntimeClassExists(input);
  const nodeNames: string[] = await readReadyKubernetesNodeNames(input);
  if (nodeNames.length === 0) {
    throw new Error('No Ready schedulable Kubernetes nodes are available for gVisor verification.');
  }
  await Promise.all(nodeNames.map(async (nodeName: string): Promise<void> => await runGvisorCanary(input, nodeName)));
  return {
    detail: `Verified gVisor sandbox through RuntimeClass "${input.runtimeClassName}" on ${String(nodeNames.length)} Ready node(s).`,
    runtimeClassName: input.runtimeClassName,
  };
}

function assertConfiguredRuntimeClassName(runtimeClassName: string): void {
  if (runtimeClassName.trim() === '') {
    throw new Error(
      'No Kubernetes sandbox RuntimeClass is configured. Install gVisor on every eligible build and tenant node, create a RuntimeClass, and set sandboxRuntime.runtimeClassName. Compartment does not modify operator-managed nodes.',
    );
  }
}

async function assertRuntimeClassExists(input: KubernetesSandboxRuntimePreflightInput): Promise<void> {
  const result: CommandResult = await runCommand(
    buildCanaryKubectlCommand(input, ['get', `runtimeclass/${input.runtimeClassName}`, '--output=json']),
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `${formatKubernetesCommandFailure(`Required gVisor RuntimeClass "${input.runtimeClassName}" is unavailable`, result)}\nInstall gVisor on every eligible build and tenant node and register this RuntimeClass before rerunning install. Compartment does not modify operator-managed nodes.`,
    );
  }
}

async function runGvisorCanary(input: KubernetesSandboxRuntimePreflightInput, nodeName: string): Promise<void> {
  const podName: string = `compartment-gvisor-${randomUUID()}`;
  let primaryFailure: Error | null = null;
  try {
    await applyCanaryPod(input, podName, nodeName);
    await waitForCanaryPod(input, podName);
    await assertCanaryKernel(input, podName);
  } catch (error) {
    primaryFailure = error instanceof Error ? error : new Error('gVisor sandbox canary failed.');
    throw primaryFailure;
  } finally {
    await deleteCanaryPod(input, podName, primaryFailure);
  }
}

async function applyCanaryPod(
  input: KubernetesSandboxRuntimePreflightInput,
  podName: string,
  nodeName: string,
): Promise<void> {
  const result: CommandResult = await runCommandWithInput(
    buildCanaryKubectlCommand(input, ['apply', '--filename', '-']),
    renderCanaryPod(input.runtimeClassName, podName, nodeName),
  );
  if (result.exitCode !== 0) {
    throw canaryFailure('Could not create the gVisor canary Pod', result);
  }
}

async function waitForCanaryPod(input: KubernetesSandboxRuntimePreflightInput, podName: string): Promise<void> {
  const result: CommandResult = await runCommandWithTimeout(
    buildCanaryKubectlCommand(input, ['wait', `pod/${podName}`, '--for=condition=Ready', '--timeout=180s']),
    canaryTimeoutMs,
  );
  if (result.exitCode !== 0) {
    throw canaryFailure('The gVisor canary Pod did not become Ready', result);
  }
}

async function assertCanaryKernel(input: KubernetesSandboxRuntimePreflightInput, podName: string): Promise<void> {
  const result: CommandResult = await runCommandWithTimeout(
    buildCanaryKubectlCommand(input, ['exec', `pod/${podName}`, '--', 'dmesg']),
    30_000,
  );
  if (result.exitCode !== 0) {
    throw canaryFailure('Could not inspect the gVisor canary kernel', result);
  }
  if (!result.stdout.toLowerCase().includes('gvisor')) {
    throw new Error(
      `RuntimeClass "${input.runtimeClassName}" did not expose the gVisor kernel log inside the canary. Fix the node runtime handler before rerunning install.`,
    );
  }
}

async function deleteCanaryPod(
  input: KubernetesSandboxRuntimePreflightInput,
  podName: string,
  primaryFailure: Error | null,
): Promise<void> {
  const result: CommandResult = await runCommandWithTimeout(
    buildCanaryKubectlCommand(input, ['delete', `pod/${podName}`, '--ignore-not-found', '--wait=false']),
    30_000,
  );
  if (result.exitCode === 0) {
    return;
  }
  const cleanupFailure: string = formatKubernetesCommandFailure('gVisor canary cleanup failed', result);
  if (primaryFailure !== null) {
    primaryFailure.message = `${primaryFailure.message}\n${cleanupFailure}`;
    return;
  }
  throw new Error(cleanupFailure);
}

function canaryFailure(message: string, result: CommandResult): Error {
  return new Error(
    `${formatKubernetesCommandFailure(message, result)}\nCompartment requires a working gVisor RuntimeClass for all builds and tenant workloads and will not install without a successful canary.`,
  );
}

function buildCanaryKubectlCommand(input: KubernetesSandboxRuntimePreflightInput, args: readonly string[]): string[] {
  return buildKubectlCommand(
    { kubeContext: input.kubeContext, kubeconfigPath: input.kubeconfigPath, namespace: 'default' },
    args,
  );
}

function renderCanaryPod(runtimeClassName: string, podName: string, nodeName: string): string {
  return JSON.stringify({
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: { name: podName, namespace: 'default' },
    spec: {
      automountServiceAccountToken: false,
      containers: [
        {
          args: ['sleep 300'],
          command: ['sh', '-c'],
          image: canaryImage,
          imagePullPolicy: 'IfNotPresent',
          name: 'canary',
          securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'] } },
        },
      ],
      restartPolicy: 'Never',
      runtimeClassName,
      nodeName,
      tolerations: [{ operator: 'Exists' }],
    },
  });
}
