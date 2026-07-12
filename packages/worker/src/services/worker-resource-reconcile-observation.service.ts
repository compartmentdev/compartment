import type { ResourceClaimIdentity } from '@compartment/contracts';
import type {
  KubeManifest,
  KubeObservation,
  KubeObservedManifest,
  ObservedResourceClaim,
} from '@compartment/kube-runtime';
import type { ObservedClaimStatus, ObservedDeploymentStatus } from './worker-resource-reconcile.service.types';

const reconcileTimeoutMs: number = 120_000;

interface ObservedRollbackManifestData {
  data?: Record<string, string> | undefined;
}

interface RollbackManifestMetadata {
  annotations?: Record<string, string> | undefined;
  labels?: Record<string, string> | undefined;
  name?: string | undefined;
  namespace?: string | undefined;
}

export function readBoundClaims(observation: KubeObservation): ResourceClaimIdentity[] | null {
  const claims: ObservedResourceClaim[] = readObservedClaims(observation);
  if (
    claims.length === 0 ||
    claims.some((claim: ObservedResourceClaim): boolean => !claim.bound || claim.uid === null)
  ) {
    return null;
  }
  return claims.map(
    (claim: ObservedResourceClaim): ResourceClaimIdentity => ({
      claimName: claim.claimName,
      uid: claim.uid!,
    }),
  );
}

export function readObservedClaims(observation: KubeObservation): ObservedResourceClaim[] {
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

export function readResourcePods(observation: KubeObservation): { deletionTimestamp?: string | undefined }[] {
  return [...observation.cache.keys()]
    .filter((key: string): boolean => key.startsWith('pods/'))
    .map((): { deletionTimestamp?: string | undefined } => ({}));
}

export function resourceDeploymentFreshAndReady(
  observation: KubeObservation,
  previousPodNames: ReadonlySet<string>,
): boolean {
  const hasFreshPod: boolean = [...readResourcePodNames(observation)].some(
    (podName: string): boolean => podName !== '' && !previousPodNames.has(podName),
  );
  return hasFreshPod && resourceDeploymentReady(observation);
}

export function readResourcePodNames(observation: KubeObservation): Set<string> {
  return new Set(
    [...observation.cache.entries()]
      .filter(([key]: [string, KubeObservedManifest]): boolean => key.startsWith('pods/'))
      .map(([, pod]: [string, KubeObservedManifest]): string => pod.metadata?.name ?? ''),
  );
}

function resourceDeploymentReady(observation: KubeObservation): boolean {
  const deployment: KubeObservedManifest | undefined = [...observation.cache.entries()].find(
    ([key]: [string, KubeObservedManifest]): boolean => key.startsWith('deployments/'),
  )?.[1];
  const status: ObservedDeploymentStatus | undefined = deployment?.status;
  return (
    status?.readyReplicas === 1 &&
    status.conditions?.some(
      (condition: { status?: string | undefined; type?: string | undefined }): boolean =>
        condition.type === 'Available' && condition.status === 'True',
    ) === true
  );
}

export async function waitUntil<T>(observation: KubeObservation, read: () => T | null): Promise<T> {
  const initial: T | null = read();
  if (initial !== null) {
    return initial;
  }
  return await new Promise<T>((resolve: (value: T) => void, reject: (error: Error) => void): void => {
    const timer: NodeJS.Timeout = setTimeout((): void => {
      unsubscribe();
      reject(new Error('Timed out waiting for Kubernetes resource lifecycle evidence.'));
    }, reconcileTimeoutMs);
    const unsubscribe: () => void = observation.onEvent((): void => {
      const value: T | null = read();
      if (value !== null) {
        clearTimeout(timer);
        unsubscribe();
        resolve(value);
      }
    });
  });
}

export function readRollbackManifest(previousJson: string | null, observation: KubeObservation): KubeManifest[] {
  if (previousJson !== null) {
    return JSON.parse(previousJson) as KubeManifest[];
  }
  const active: KubeManifest[] = [...observation.cache.values()]
    .filter(
      (manifest: KubeObservedManifest): manifest is KubeManifest =>
        manifest.kind === 'Deployment' || manifest.kind === 'Secret' || manifest.kind === 'Service',
    )
    .map(normalizeRollbackManifest)
    .sort((left: KubeManifest, right: KubeManifest): number =>
      `${left.kind}/${left.metadata?.namespace ?? ''}/${left.metadata?.name ?? ''}`.localeCompare(
        `${right.kind}/${right.metadata?.namespace ?? ''}/${right.metadata?.name ?? ''}`,
      ),
    );
  if (!active.some((manifest: KubeManifest): boolean => manifest.kind === 'Deployment')) {
    throw new Error('Resource reconcile refused: active executable manifest is unavailable for rollback.');
  }
  return active;
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
