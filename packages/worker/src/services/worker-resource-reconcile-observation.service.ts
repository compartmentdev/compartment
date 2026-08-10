import type { ResourceClaimIdentity } from '@compartment/contracts';
import {
  assertResourceClaimIdentity,
  assertResourceClaimOwnership,
  kubeResourceVolumeName,
  projectResourceBootstrapClaims,
  projectResourceManifests,
  projectWorkloadScheduling,
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
import { findObservedManifest, waitUntil } from './worker-resource-reconcile-wait.service';

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

export function readRollbackManifest(
  previousJson: string | null,
  observation: KubeObservation,
  desired: KubeManifest[],
  hasLivePods: boolean,
): KubeManifest[] | null {
  if (previousJson !== null) {
    return projectWorkloadScheduling(JSON.parse(previousJson) as KubeManifest[], desired);
  }
  const active: KubeManifest[] = readActiveManifests(observation, desired);
  const deployment: KubeManifest | undefined = active.find(
    (manifest: KubeManifest): boolean => manifest.kind === 'Deployment',
  );
  const replicas: number | undefined = (deployment?.spec as ObservedRollbackDeploymentSpec | undefined)?.replicas;
  if (active.length === desired.length && deployment !== undefined && replicas !== undefined) {
    return projectWorkloadScheduling(active, desired);
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
