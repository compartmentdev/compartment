import type { JsonValue } from '@compartment/utils';
import { runCommand } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import type {
  KubernetesInstallPreflightInput,
  KubernetesInstallPreflightResult,
  KubernetesStorageClassItem,
  KubernetesStorageClassList,
} from './kubernetes-install-preflight.service.types';

const requestTimeout: string = '3s';

class KubernetesInstallPreflightError extends Error {
  readonly check: 'cluster' | 'storage class';

  constructor(check: 'cluster' | 'storage class', message: string) {
    super(message);
    this.check = check;
  }
}

export async function runKubernetesInstallPreflight(
  input: KubernetesInstallPreflightInput,
): Promise<KubernetesInstallPreflightResult> {
  await assertClusterReachable(input);
  return { storageClass: input.detectStorageClass ? await readDetectedStorageClass(input) : '' };
}

async function readDetectedStorageClass(input: KubernetesInstallPreflightInput): Promise<string> {
  const storageClasses: KubernetesStorageClassList = await readClusterJson<KubernetesStorageClassList>(
    buildKubectlCommand(input, ['get', 'storageclass', '--output', 'json']),
    'storage classes',
  );
  return detectStorageClass(storageClasses);
}

async function assertClusterReachable(input: KubernetesInstallPreflightInput): Promise<void> {
  const result: CommandResult = await runCommand(buildKubectlCommand(input, ['version', '--output', 'json']));
  if (result.exitCode !== 0) {
    if (result.exitCode === 127) {
      throw new KubernetesInstallPreflightError('cluster', 'kubectl is not installed or not on PATH.');
    }
    throw new KubernetesInstallPreflightError(
      'cluster',
      `Cannot reach Kubernetes cluster at ${input.resolvedKubeconfig.clusterServer}. Verify the cluster is running and your kubeconfig credentials are valid, then retry install.`,
    );
  }
}

async function readClusterJson<T>(command: string[], subject: string): Promise<T> {
  const result: CommandResult = await runCommand(command);
  if (result.exitCode !== 0) {
    throw new KubernetesInstallPreflightError(
      'storage class',
      `Cannot inspect Kubernetes ${subject}. Verify your cluster access and retry install.`,
    );
  }
  try {
    const value: JsonValue = JSON.parse(result.stdout) as JsonValue;
    if (isObject(value) && Array.isArray(value.items)) {
      return value as T;
    }
  } catch {
    // The shared error below is stable for malformed kubectl output.
  }
  throw new KubernetesInstallPreflightError('storage class', `Kubernetes returned an invalid ${subject} response.`);
}

function buildKubectlCommand(input: KubernetesInstallPreflightInput, args: readonly string[]): string[] {
  return [
    'kubectl',
    '--kubeconfig',
    input.resolvedKubeconfig.path,
    ...(input.kubeContext === undefined ? [] : ['--context', input.kubeContext]),
    '--request-timeout',
    requestTimeout,
    ...args,
  ];
}

function detectStorageClass(list: KubernetesStorageClassList): string {
  return list.items.some((item: KubernetesStorageClassItem): boolean => item.metadata?.name === 'local-path')
    ? 'local-path'
    : '';
}

function isObject(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
