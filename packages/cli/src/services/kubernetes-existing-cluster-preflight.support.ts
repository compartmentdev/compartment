import type { JsonValue } from '@compartment/utils';
import type { CommandResult } from '../command-runner.types';
import { readCommandOutput } from './kubernetes-command.support';
import type { KubernetesInstallInput } from './kubernetes-install-input.service.types';
import type {
  KubernetesExistingClusterPreflightCheck,
  KubernetesObject,
  KubernetesObjectList,
  KubernetesObjectMetadata,
} from './kubernetes-existing-cluster-preflight.service.types';

export const certManagerInstallInstruction: string =
  'Install cert-manager v1.21.0: kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.21.0/cert-manager.yaml';
export const defaultStorageClassAnnotation: string = 'storageclass.kubernetes.io/is-default-class';
export const ingressDefaultAnnotation: string = 'ingressclass.kubernetes.io/is-default-class';
export const helmReleaseNameAnnotation: string = 'meta.helm.sh/release-name';
export const helmReleaseNamespaceAnnotation: string = 'meta.helm.sh/release-namespace';

const requestTimeout: string = '5s';

export class KubernetesExistingClusterPreflightError extends Error {
  readonly check: KubernetesExistingClusterPreflightCheck;

  constructor(check: KubernetesExistingClusterPreflightCheck, message: string) {
    super(message);
    this.check = check;
  }
}

export function buildPreflightKubectl(input: KubernetesInstallInput, args: readonly string[]): string[] {
  return [
    'kubectl',
    '--kubeconfig',
    input.kubeconfigPath,
    '--context',
    input.kubeContext,
    '--request-timeout',
    requestTimeout,
    ...args,
  ];
}

export function readPreflightList<T>(
  result: CommandResult,
  check: KubernetesExistingClusterPreflightCheck,
  message: string,
): KubernetesObjectList<T> {
  const value: KubernetesObjectList<T> = readPreflightObject(result, check, message);
  if (!Array.isArray(value.items)) {
    throw new KubernetesExistingClusterPreflightError(check, message);
  }
  return value;
}

export function readPreflightObject<T>(
  result: CommandResult,
  check: KubernetesExistingClusterPreflightCheck,
  message: string,
): T {
  if (result.exitCode !== 0) {
    throw new KubernetesExistingClusterPreflightError(check, `${message} ${readCommandFailure(result)}`);
  }
  return parsePreflightJson(result.stdout, check, message);
}

export function parsePreflightJson<T>(
  value: string,
  check: KubernetesExistingClusterPreflightCheck,
  message: string,
): T {
  try {
    const parsed: JsonValue = JSON.parse(value) as JsonValue;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as T;
    }
  } catch {
    // The stable error below is used for malformed command output.
  }
  throw new KubernetesExistingClusterPreflightError(check, message);
}

export function readMetadataNames(items: readonly { metadata?: KubernetesObjectMetadata | undefined }[]): string[] {
  return items
    .map((item: KubernetesObject): string | undefined => item.metadata?.name)
    .filter((name: string | undefined): name is string => name !== undefined);
}

export function isPreflightNotFound(result: CommandResult): boolean {
  return result.exitCode !== 0 && /notfound|not found/iu.test(result.stderr);
}

export function readCommandFailure(result: CommandResult): string {
  const output: string = readCommandOutput(result);
  return (output === '' ? `command exited ${String(result.exitCode)}` : output).replace(/\s+/gu, ' ');
}
