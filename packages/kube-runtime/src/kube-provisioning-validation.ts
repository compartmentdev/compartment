import { type KubernetesObjectApi } from '@kubernetes/client-node';
import type { KubeManifest, KubeManifestKind } from './kube-runtime.types';

interface KubeApiError {
  code?: number | undefined;
  statusCode?: number | undefined;
}

interface KubeObjectHeaderMetadata {
  name: string;
  namespace?: string;
}

interface KubeObjectHeader {
  apiVersion: string;
  kind: KubeManifestKind;
  metadata: KubeObjectHeaderMetadata;
}

interface ProvisioningSubject {
  kind: 'ServiceAccount';
  name: string;
  namespace: string;
}

export async function createOrValidate(
  objectApi: KubernetesObjectApi,
  reader: KubernetesObjectApi | null,
  object: KubeManifest,
): Promise<KubeManifest> {
  try {
    return await objectApi.create(object);
  } catch (error) {
    const apiError: KubeApiError = error as KubeApiError;
    if ((apiError.code !== 409 && apiError.statusCode !== 409) || reader === null) {
      throw error;
    }
    const existing: KubeManifest = await reader.read<KubeManifest>(objectHeader(object));
    validateExistingProvisioningObject(existing, object);
    return existing;
  }
}

function objectHeader(object: KubeManifest): KubeObjectHeader {
  const name: string | undefined = object.metadata?.name;
  const apiVersion: string | undefined = object.apiVersion;
  if (name === undefined || apiVersion === undefined) {
    throw new Error(`Kubernetes ${object.kind} requires an API version and name.`);
  }
  return {
    apiVersion,
    kind: object.kind,
    metadata: { name, ...(object.metadata?.namespace === undefined ? {} : { namespace: object.metadata.namespace }) },
  };
}

function validateExistingProvisioningObject(existing: KubeManifest, desired: KubeManifest): void {
  const sameIdentity: boolean =
    existing.kind === desired.kind &&
    existing.metadata?.name === desired.metadata?.name &&
    existing.metadata?.namespace === desired.metadata?.namespace;
  if (!sameIdentity || !hasSameProvisioningFields(existing, desired)) {
    throw new Error(`Existing Kubernetes ${desired.kind} does not match the provisioning contract.`);
  }
}

function hasSameProvisioningFields(existing: KubeManifest, desired: KubeManifest): boolean {
  if (desired.kind === 'Namespace') {
    return hasDesiredLabels(existing, desired);
  }
  if (desired.kind === 'ServiceAccount') {
    return existing.automountServiceAccountToken === false;
  }
  return (
    desired.kind === 'RoleBinding' && hasSameRoleReference(existing, desired) && hasSameSubjects(existing, desired)
  );
}

function hasSameRoleReference(existing: KubeManifest, desired: KubeManifest): boolean {
  return (
    existing.roleRef?.apiGroup === desired.roleRef?.apiGroup &&
    existing.roleRef?.kind === desired.roleRef?.kind &&
    existing.roleRef?.name === desired.roleRef?.name
  );
}

function hasSameSubjects(existing: KubeManifest, desired: KubeManifest): boolean {
  const existingSubjects: ProvisioningSubject[] = existing.subjects ?? [];
  const desiredSubjects: ProvisioningSubject[] = desired.subjects ?? [];
  return (
    existingSubjects.length === desiredSubjects.length &&
    desiredSubjects.every((subject: ProvisioningSubject, index: number): boolean => {
      const existingSubject: ProvisioningSubject | undefined = existingSubjects[index];
      return existingSubject?.name === subject.name && existingSubject.namespace === subject.namespace;
    })
  );
}

function hasDesiredLabels(existing: KubeManifest, desired: KubeManifest): boolean {
  return Object.entries(desired.metadata?.labels ?? {}).every(
    ([key, value]: [string, string]): boolean => existing.metadata?.labels?.[key] === value,
  );
}
