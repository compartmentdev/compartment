import { resourceReconcileLifecycleTimeoutMs, type ResourceClaimIdentity } from '@compartment/contracts';
import {
  assertResourceClaimIdentity,
  assertResourceClaimOwnership,
  kubeResourceVolumeName,
  projectResourceBootstrapClaims,
  projectResourceManifests,
  projectResourceRollbackScheduling,
  resourcePodsFullyTerminated,
  type KubeManifest,
  type KubeObservation,
  type KubeObservedManifest,
  type KubeRuntime,
  type ObservedResourceClaim,
  type ResourceProjectionRow,
  type ResourceVolumeProjection,
} from '@compartment/kube-runtime';
import { readLiveResourceClaims, toObservedResourceClaim } from './worker-resource-claim-observation.service';
import {
  assertResourceReconcileActive,
  findObservedManifest,
  waitUntil,
} from './worker-resource-reconcile-wait.service';

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
      ([, claim]: [string, KubeObservedManifest]): ObservedResourceClaim =>
        toObservedResourceClaim(claim.metadata?.name ?? '', claim),
    );
}

export async function readLiveClaims(
  runtime: KubeRuntime,
  row: ResourceProjectionRow,
): Promise<ObservedResourceClaim[]> {
  return await readLiveResourceClaims(runtime, projectResourceBootstrapClaims(row));
}

export function projectManagedResourceManifests(
  row: ResourceProjectionRow,
  replicas: 0 | 1,
  infrastructureTimeoutMs: number,
): KubeManifest[] {
  return projectResourceManifests(row, infrastructureTimeoutMs, replicas);
}

export function assertFinalClaimState(
  expectedClaims: ResourceClaimIdentity[],
  observedClaims: ObservedResourceClaim[],
  row: ResourceProjectionRow,
): void {
  assertResourceClaimOwnership(expectedClaims, observedClaims);
  const mountedNames: Set<string> = mountedClaimNames(row);
  if (mountedNames.size === 0) {
    return;
  }
  assertResourceClaimIdentity(
    expectedClaims.filter((claim: ResourceClaimIdentity): boolean => mountedNames.has(claim.claimName)),
    observedClaims.filter((claim: ObservedResourceClaim): boolean => mountedNames.has(claim.claimName)),
  );
}

export async function waitForMountedResourceClaims(
  observation: KubeObservation,
  expectedClaims: ResourceClaimIdentity[],
  row: ResourceProjectionRow,
  manifests: KubeManifest[],
  infrastructureTimeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  const mountedNames: Set<string> = mountedClaimNames(row);
  const startsWorkload: boolean = manifests.some(
    (manifest: KubeManifest): boolean => manifest.kind === 'Deployment' && manifest.spec?.replicas === 1,
  );
  if (!startsWorkload || mountedNames.size === 0) {
    return;
  }
  await waitUntil(
    observation,
    (): true | null => {
      const observedClaims: ObservedResourceClaim[] = readObservedClaims(observation);
      assertResourceClaimOwnership(expectedClaims, observedClaims);
      return observedClaims
        .filter((claim: ObservedResourceClaim): boolean => mountedNames.has(claim.claimName))
        .every((claim: ObservedResourceClaim): boolean => claim.bound)
        ? true
        : null;
    },
    infrastructureTimeoutMs,
    signal,
  );
}

function mountedClaimNames(row: ResourceProjectionRow): Set<string> {
  return new Set<string>(
    row.volumes.map((volume: ResourceVolumeProjection): string =>
      kubeResourceVolumeName(row.resourceId, volume.volumeHandle),
    ),
  );
}

export async function scaleDownAndAwaitTermination(
  runtime: KubeRuntime,
  observation: KubeObservation,
  row: ResourceProjectionRow,
  signal?: AbortSignal,
): Promise<void> {
  assertResourceReconcileActive(signal);
  await runtime.apply({ objects: projectManagedResourceManifests(row, 0, resourceReconcileLifecycleTimeoutMs) });
  await waitUntil(
    observation,
    (): true | null => (resourcePodsFullyTerminated(readResourcePods(observation)) ? true : null),
    resourceReconcileLifecycleTimeoutMs,
    signal,
  );
}

export function readResourcePods(observation: KubeObservation): { deletionTimestamp?: string | undefined }[] {
  return [...observation.cache.keys()]
    .filter((key: string): boolean => key.startsWith('pods/'))
    .map((): { deletionTimestamp?: string | undefined } => ({}));
}

export function readRollbackManifest(
  previousJson: string | null,
  observation: KubeObservation,
  desired: KubeManifest[],
  row: ResourceProjectionRow,
  hasLivePods: boolean,
): KubeManifest[] | null {
  if (previousJson !== null) {
    return projectResourceRollbackScheduling(JSON.parse(previousJson) as KubeManifest[], row);
  }
  const active: KubeManifest[] = readActiveManifests(observation, desired);
  const deployment: KubeManifest | undefined = active.find(
    (manifest: KubeManifest): boolean => manifest.kind === 'Deployment',
  );
  const replicas: number | undefined = (deployment?.spec as ObservedRollbackDeploymentSpec | undefined)?.replicas;
  if (active.length === desired.length && deployment !== undefined && replicas !== undefined) {
    return projectResourceRollbackScheduling(active, row);
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
