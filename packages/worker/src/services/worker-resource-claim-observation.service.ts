import type { KubeManifest, KubeObservedManifest, KubeRuntime, ObservedResourceClaim } from '@compartment/kube-runtime';
import type { ObservedClaimStatus } from './worker-resource-claim-observation.service.types';

/**
 * Reads the named claims straight from the API server and projects each into the identity the
 * ownership assertions compare against. Both the reconcile lane and the Product Job fence ask this
 * question, so the projection - including what counts as bound - is stated once.
 */
export async function readLiveResourceClaims(
  runtime: KubeRuntime,
  claims: readonly KubeManifest[],
): Promise<ObservedResourceClaim[]> {
  return await Promise.all(
    claims.map(async (claim: KubeManifest): Promise<ObservedResourceClaim> => {
      const observed: KubeObservedManifest | null = await runtime.read(claim);
      return toObservedResourceClaim(claim.metadata?.name ?? '', observed);
    }),
  );
}

export function toObservedResourceClaim(
  claimName: string,
  observed: KubeObservedManifest | null,
): ObservedResourceClaim {
  return {
    bound: (observed?.status as ObservedClaimStatus | undefined)?.phase === 'Bound',
    claimName,
    resourceVersion: observed?.metadata?.resourceVersion ?? null,
    uid: observed?.metadata?.uid ?? null,
  };
}
