import type { RegistryInstallVerificationOutput } from '@compartment/contracts';
import { runCommandWithInput, runCommandWithTimeout } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import { buildKubectlCommand, formatKubernetesCommandFailure } from './kubernetes-command.support';
import type { KubernetesInstallDeploymentInput } from './kubernetes-install.service.types';
import type {
  KubernetesNodeList,
  KubernetesNodeListItem,
  KubernetesNodeStatusCondition,
} from './kubernetes-install-registry-verification.service.types';

const verificationTimeoutMs: number = 5 * 60_000;
const verificationSecretName: string = 'compartment-registry-acceptance';

export async function verifyKubernetesInstallRegistryNodePull(input: KubernetesInstallDeploymentInput): Promise<void> {
  const verification: RegistryInstallVerificationOutput = await pushRegistryAcceptanceImage(input);
  const nodes: string[] = await readEligibleNodeNames(input);
  if (nodes.length === 0) {
    throw new Error('Registry node-pull verification found no eligible Ready nodes.');
  }
  const podNames: string[] = nodes.map(
    (_node: string, index: number): string => `registry-acceptance-${index.toString()}`,
  );
  try {
    await applyVerificationSecret(input, verification.dockerConfigJson);
    for (let index: number = 0; index < nodes.length; index += 1) {
      await applyVerificationPod(input, podNames[index]!, nodes[index]!, verification.imageRef);
      await waitForVerificationPod(input, podNames[index]!, nodes[index]!);
    }
  } finally {
    await deleteVerificationObjects(input, podNames);
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

async function readEligibleNodeNames(input: KubernetesInstallDeploymentInput): Promise<string[]> {
  const result: CommandResult = await runCommandWithTimeout(
    buildKubectlCommand(input, ['get', 'nodes', '--output', 'json']),
    30_000,
  );
  if (result.exitCode !== 0) {
    throw new Error(formatKubernetesCommandFailure('Registry node inventory failed', result));
  }
  try {
    const nodes: KubernetesNodeList = JSON.parse(result.stdout) as KubernetesNodeList;
    return nodes.items
      .filter(isEligibleNode)
      .map((node: KubernetesNodeListItem): string | undefined => node.metadata?.name)
      .filter((name: string | undefined): name is string => name !== undefined && name !== '');
  } catch {
    throw new Error('Registry node inventory returned invalid JSON.');
  }
}

function isEligibleNode(node: KubernetesNodeListItem): boolean {
  return (
    node.spec?.unschedulable !== true &&
    node.status?.conditions?.some(
      (condition: KubernetesNodeStatusCondition): boolean => condition.type === 'Ready' && condition.status === 'True',
    ) === true
  );
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
  podName: string,
  nodeName: string,
): Promise<void> {
  const result: CommandResult = await runCommandWithTimeout(
    buildKubectlCommand(input, ['wait', `pod/${podName}`, '--for=condition=Ready', '--timeout=180s']),
    verificationTimeoutMs,
  );
  if (result.exitCode !== 0) {
    throw new Error(formatKubernetesCommandFailure(`Registry node pull failed on ${nodeName}`, result));
  }
}

async function runRequiredInputCommand(command: string[], manifest: string, message: string): Promise<void> {
  const result: CommandResult = await runCommandWithInput(command, manifest);
  if (result.exitCode !== 0) {
    throw new Error(formatKubernetesCommandFailure(message, result));
  }
}

async function deleteVerificationObjects(input: KubernetesInstallDeploymentInput, podNames: string[]): Promise<void> {
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
    throw new Error(formatKubernetesCommandFailure('Registry acceptance cleanup failed', result));
  }
}
