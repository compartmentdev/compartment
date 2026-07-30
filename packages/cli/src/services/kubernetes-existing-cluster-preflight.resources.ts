import { createHash } from 'node:crypto';
import { runCommand } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import { assertExactHelmOwnership } from './kubernetes-existing-cluster-preflight.cluster';
import type { KubernetesInstallInput } from './kubernetes-install-input.service.types';
import type {
  KubernetesIngress,
  KubernetesIngressClass,
  KubernetesIngressRule,
  KubernetesObject,
  KubernetesObjectList,
  KubernetesObjectMetadata,
  KubernetesStorageClass,
} from './kubernetes-existing-cluster-preflight.service.types';
import {
  buildPreflightKubectl,
  defaultStorageClassAnnotation,
  ingressDefaultAnnotation,
  isPreflightNotFound,
  KubernetesExistingClusterPreflightError,
  readMetadataNames,
  readPreflightList,
  readPreflightObject,
} from './kubernetes-existing-cluster-preflight.support';

export async function assertIngressClass(input: KubernetesInstallInput): Promise<void> {
  const result: CommandResult = await runCommand(
    buildPreflightKubectl(input, ['get', 'ingressclasses.networking.k8s.io', '-o=json']),
  );
  const list: KubernetesObjectList<KubernetesIngressClass> = readPreflightList(
    result,
    'ingress class',
    'Cannot inspect IngressClasses.',
  );
  const names: string[] = readMetadataNames(list.items);
  if (input.ingressClass === '') {
    assertUnambiguousIngressClass(list.items, names);
  } else if (!names.includes(input.ingressClass)) {
    throw new KubernetesExistingClusterPreflightError(
      'ingress class',
      `IngressClass "${input.ingressClass}" does not exist.`,
    );
  }
}

export async function assertStorageClass(input: KubernetesInstallInput): Promise<void> {
  const result: CommandResult = await runCommand(
    buildPreflightKubectl(input, ['get', 'storageclasses.storage.k8s.io', '-o=json']),
  );
  const list: KubernetesObjectList<KubernetesStorageClass> = readPreflightList(
    result,
    'storage class',
    'Cannot inspect StorageClasses.',
  );
  const names: string[] = readMetadataNames(list.items);
  if (input.storageClass === '') {
    assertUnambiguousStorageClass(list.items, names);
  } else if (!names.includes(input.storageClass)) {
    throw new KubernetesExistingClusterPreflightError(
      'storage class',
      `StorageClass "${input.storageClass}" does not exist.`,
    );
  }
}

export async function assertIngressHostsAvailable(
  input: KubernetesInstallInput,
  expectedHosts: readonly string[],
): Promise<void> {
  const result: CommandResult = await runCommand(
    buildPreflightKubectl(input, ['get', 'ingresses.networking.k8s.io', '--all-namespaces', '-o=json']),
  );
  const list: KubernetesObjectList<KubernetesIngress> = readPreflightList(
    result,
    'host ownership',
    'Cannot inspect existing Ingress hosts.',
  );
  for (const ingress of list.items) {
    assertIngressHasNoCollision(ingress, input, expectedHosts);
  }
}

export async function assertRetainedIdentity(input: KubernetesInstallInput): Promise<void> {
  const name: string = readInstallStateSecretName(input.releaseName);
  const result: CommandResult = await runCommand(
    buildPreflightKubectl(input, ['get', 'secret', name, '--namespace', input.namespace, '-o=json']),
  );
  if (isPreflightNotFound(result)) {
    return;
  }
  const secret: KubernetesObject = readPreflightObject(
    result,
    'retained identity',
    'Cannot inspect retained installation identity.',
    { includeStdout: false },
  );
  assertExactHelmOwnership(
    secret.metadata,
    input,
    `Retained installation identity ${secret.metadata?.name ?? '<unnamed>'}`,
  );
}

function assertUnambiguousIngressClass(items: readonly KubernetesIngressClass[], names: readonly string[]): void {
  const defaults: string[] = items
    .filter(
      (item: KubernetesIngressClass): boolean => item.metadata?.annotations?.[ingressDefaultAnnotation] === 'true',
    )
    .flatMap((item: KubernetesIngressClass): string[] =>
      item.metadata?.name === undefined ? [] : [item.metadata.name],
    );
  if (names.length !== 1 && defaults.length !== 1) {
    throw selectionError('IngressClass', names, '--ingress-class');
  }
}

function assertUnambiguousStorageClass(items: readonly KubernetesStorageClass[], names: readonly string[]): void {
  const defaults: string[] = items
    .filter(
      (item: KubernetesStorageClass): boolean => item.metadata?.annotations?.[defaultStorageClassAnnotation] === 'true',
    )
    .flatMap((item: KubernetesStorageClass): string[] =>
      item.metadata?.name === undefined ? [] : [item.metadata.name],
    );
  if (defaults.length !== 1) {
    throw selectionError('StorageClass', names, '--storage-class');
  }
}

function assertIngressHasNoCollision(
  ingress: KubernetesIngress,
  input: KubernetesInstallInput,
  expectedHosts: readonly string[],
): void {
  const foreign: boolean =
    ingress.metadata?.namespace !== input.namespace || readInstanceLabel(ingress.metadata) !== input.releaseName;
  const collision: string | undefined = (ingress.spec?.rules ?? [])
    .map((rule: KubernetesIngressRule): string | undefined => rule.host)
    .find((host: string | undefined): boolean => host !== undefined && foreign && expectedHosts.includes(host));
  if (collision !== undefined) {
    throw new KubernetesExistingClusterPreflightError(
      'host ownership',
      `Ingress host "${collision}" is already owned by ${ingress.metadata?.namespace ?? 'default'}/${ingress.metadata?.name ?? '<unnamed>'}.`,
    );
  }
}

function readInstanceLabel(metadata: KubernetesObjectMetadata | undefined): string | undefined {
  if (metadata?.labels === undefined) {
    return undefined;
  }
  return metadata.labels['app.kubernetes.io/instance'];
}

function selectionError(
  kind: 'IngressClass' | 'StorageClass',
  names: readonly string[],
  option: '--ingress-class' | '--storage-class',
): KubernetesExistingClusterPreflightError {
  const choices: string = names.length === 0 ? 'none found' : names.join(', ');
  return new KubernetesExistingClusterPreflightError(
    kind === 'IngressClass' ? 'ingress class' : 'storage class',
    `${kind} selection is ambiguous (${choices}); choose one with ${option}.`,
  );
}

function readInstallStateSecretName(releaseName: string): string {
  const candidate: string = `${releaseName}-install-state`;
  if (candidate.length <= 63) {
    return candidate;
  }
  const prefix: string = candidate.slice(0, 54).replace(/-+$/gu, '');
  const digest: string = createHash('sha256').update(releaseName).digest('hex').slice(0, 8);
  return `${prefix}-${digest}`;
}
