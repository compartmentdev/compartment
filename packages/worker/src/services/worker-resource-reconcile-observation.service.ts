import type { ResourceClaimIdentity } from '@compartment/contracts';
import {
  assertResourceClaimIdentity,
  assertResourceClaimOwnership,
  kubeResourceVolumeName,
  projectResourceBootstrapClaims,
  projectResourceManifests,
  resourcePodsFullyTerminated,
  type KubeManifest,
  type KubeObservation,
  type KubeObservedManifest,
  type KubeDeploymentManifest,
  type KubeRuntime,
  type ObservedResourceClaim,
  type ResourceProjectionRow,
  type ResourceVolumeProjection,
} from '@compartment/kube-runtime';
import type { ObservedClaimStatus, ObservedDeploymentStatus } from './worker-resource-reconcile.service.types';

const reconcileTimeoutMs: number = 120_000;

interface ObservedRollbackManifestData {
  data?: Record<string, string> | undefined;
}

interface ObservedRollbackDeploymentSpec {
  replicas?: number | undefined;
}

interface RollbackManifestMetadata {
  annotations?: Record<string, string> | undefined;
  labels?: Record<string, string> | undefined;
  name?: string | undefined;
  namespace?: string | undefined;
}

export function readCreatedClaims(observation: KubeObservation, expectedCount: number): ResourceClaimIdentity[] | null {
  const claims: ObservedResourceClaim[] = readObservedClaims(observation);
  if (claims.length !== expectedCount || claims.some((claim: ObservedResourceClaim): boolean => claim.uid === null)) {
    return null;
  }
  return claims.map(
    (claim: ObservedResourceClaim): ResourceClaimIdentity => ({
      claimName: claim.claimName,
      uid: claim.uid!,
    }),
  );
}

function readObservedClaims(observation: KubeObservation): ObservedResourceClaim[] {
  return [...observation.cache.entries()]
    .filter(([key]: [string, KubeObservedManifest]): boolean => key.startsWith('persistentvolumeclaims/'))
    .map(
      ([, claim]: [string, KubeObservedManifest]): ObservedResourceClaim => ({
        bound: (claim.status as ObservedClaimStatus | undefined)?.phase === 'Bound',
        claimName: claim.metadata?.name ?? '',
        uid: claim.metadata?.uid ?? null,
      }),
    );
}

export function readLiveClaims(observation: KubeObservation, row: ResourceProjectionRow): ObservedResourceClaim[] {
  return projectResourceBootstrapClaims(row).map((claim: KubeManifest): ObservedResourceClaim => {
    const observed: KubeObservedManifest | null = findObservedManifest(observation, claim);
    return {
      bound: (observed?.status as ObservedClaimStatus | undefined)?.phase === 'Bound',
      claimName: claim.metadata?.name ?? '',
      uid: observed?.metadata?.uid ?? null,
    };
  });
}

export function assertFinalClaimState(
  expectedClaims: ResourceClaimIdentity[],
  observedClaims: ObservedResourceClaim[],
  row: ResourceProjectionRow,
): void {
  assertResourceClaimOwnership(expectedClaims, observedClaims);
  const mountedNames: Set<string> = new Set<string>(
    row.volumes.map((volume: ResourceVolumeProjection): string =>
      kubeResourceVolumeName(row.resourceId, volume.volumeHandle),
    ),
  );
  if (mountedNames.size === 0) {
    return;
  }
  assertResourceClaimIdentity(
    expectedClaims.filter((claim: ResourceClaimIdentity): boolean => mountedNames.has(claim.claimName)),
    observedClaims.filter((claim: ObservedResourceClaim): boolean => mountedNames.has(claim.claimName)),
  );
}

export async function scaleDownAndAwaitTermination(
  runtime: KubeRuntime,
  observation: KubeObservation,
  row: ResourceProjectionRow,
): Promise<void> {
  await runtime.apply({ objects: projectResourceManifests(row, 0) });
  await waitUntil(observation, (): true | null =>
    resourcePodsFullyTerminated(readResourcePods(observation)) ? true : null,
  );
}

export function readResourcePods(observation: KubeObservation): { deletionTimestamp?: string | undefined }[] {
  return [...observation.cache.keys()]
    .filter((key: string): boolean => key.startsWith('pods/'))
    .map((): { deletionTimestamp?: string | undefined } => ({}));
}

export async function waitForFreshResourceDeployment(
  observation: KubeObservation,
  manifests: KubeManifest[],
): Promise<void> {
  const desired: KubeDeploymentManifest = requiredDeployment(manifests);
  await waitUntil(observation, (): true | null =>
    resourceDeploymentFreshAndReady(findObservedManifest(observation, desired), desired) ? true : null,
  );
}

function resourceDeploymentFreshAndReady(
  observed: KubeObservedManifest | null,
  desired: KubeDeploymentManifest,
): boolean {
  if (observed?.kind !== 'Deployment') {
    return false;
  }
  const status: ObservedDeploymentStatus | undefined = observed.status;
  if (status === undefined) {
    return false;
  }
  const desiredReplicas: number | undefined = desired.spec?.replicas;
  return (
    desiredReplicas !== undefined &&
    observed.metadata?.uid === desired.metadata?.uid &&
    generationIsCurrent(observed.metadata?.generation, status.observedGeneration, desired.metadata?.generation) &&
    (status.availableReplicas ?? 0) >= desiredReplicas
  );
}

function generationIsCurrent(
  generation: number | undefined,
  observedGeneration: number | undefined,
  desiredGeneration: number | undefined,
): boolean {
  return (
    generation !== undefined &&
    observedGeneration !== undefined &&
    desiredGeneration !== undefined &&
    generation === desiredGeneration &&
    observedGeneration === desiredGeneration
  );
}

export async function waitUntil<T>(observation: KubeObservation, read: () => T | null): Promise<T> {
  const initial: T | null = read();
  if (initial !== null) {
    return initial;
  }
  return await new Promise<T>((resolve: (value: T) => void, reject: (error: Error) => void): void => {
    let unsubscribe: () => void = (): void => undefined;
    const resolveWhenReady: () => void = (): void => {
      const value: T | null = read();
      if (value !== null) {
        clearTimeout(timer);
        unsubscribe();
        resolve(value);
      }
    };
    const timer: NodeJS.Timeout = setTimeout((): void => {
      unsubscribe();
      reject(new Error('Timed out waiting for Kubernetes resource lifecycle evidence.'));
    }, reconcileTimeoutMs);
    unsubscribe = observation.onEvent(resolveWhenReady);
    resolveWhenReady();
  });
}

function requiredDeployment(manifests: KubeManifest[]): KubeDeploymentManifest {
  const deployment: KubeManifest | undefined = manifests.find(
    (manifest: KubeManifest): boolean => manifest.kind === 'Deployment',
  );
  if (deployment?.kind !== 'Deployment') {
    throw new Error('Resource reconcile Deployment manifest is missing.');
  }
  return deployment;
}

export function readRollbackManifest(
  previousJson: string | null,
  observation: KubeObservation,
  desired: KubeManifest[],
  hasLivePods: boolean,
): KubeManifest[] | null {
  if (previousJson !== null) {
    return JSON.parse(previousJson) as KubeManifest[];
  }
  const active: KubeManifest[] = readActiveManifests(observation, desired);
  const deployment: KubeManifest | undefined = active.find(
    (manifest: KubeManifest): boolean => manifest.kind === 'Deployment',
  );
  const replicas: number | undefined = (deployment?.spec as ObservedRollbackDeploymentSpec | undefined)?.replicas;
  if (active.length === desired.length && deployment !== undefined && replicas !== undefined) {
    return active;
  }
  if (hasLivePods || deployment !== undefined) {
    throw new Error('Managed resource update requires a complete rollback snapshot before mutating live state.');
  }
  return null;
}

function readActiveManifests(observation: KubeObservation, desired: KubeManifest[]): KubeManifest[] {
  return desired
    .map((manifest: KubeManifest): KubeObservedManifest | null => findObservedManifest(observation, manifest))
    .filter((manifest: KubeObservedManifest | null): manifest is KubeManifest => manifest !== null)
    .map(normalizeRollbackManifest)
    .sort((left: KubeManifest, right: KubeManifest): number =>
      `${left.kind}/${left.metadata?.namespace ?? ''}/${left.metadata?.name ?? ''}`.localeCompare(
        `${right.kind}/${right.metadata?.namespace ?? ''}/${right.metadata?.name ?? ''}`,
      ),
    );
}

function findObservedManifest(observation: KubeObservation, desired: KubeManifest): KubeObservedManifest | null {
  return (
    [...observation.cache.values()].find(
      (observed: KubeObservedManifest): boolean =>
        observed.kind === desired.kind && observed.metadata?.name === desired.metadata?.name,
    ) ?? null
  );
}

function normalizeRollbackManifest(manifest: KubeManifest): KubeManifest {
  const observed: KubeManifest & ObservedRollbackManifestData = manifest;
  const metadata: RollbackManifestMetadata = {
    ...(manifest.metadata?.annotations === undefined ? {} : { annotations: manifest.metadata.annotations }),
    ...(manifest.metadata?.labels === undefined ? {} : { labels: manifest.metadata.labels }),
    ...(manifest.metadata?.name === undefined ? {} : { name: manifest.metadata.name }),
    ...(manifest.metadata?.namespace === undefined ? {} : { namespace: manifest.metadata.namespace }),
  };
  return {
    apiVersion: manifest.apiVersion,
    kind: manifest.kind,
    metadata,
    ...(observed.data === undefined ? {} : { data: observed.data }),
    ...(manifest.spec === undefined ? {} : { spec: manifest.spec }),
  } as KubeManifest;
}
