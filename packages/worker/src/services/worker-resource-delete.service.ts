import {
  assertResourceClaimOwnership,
  projectResourceClaimDeleteTargets,
  projectResourceManifests,
  type KubeObservation,
  type KubeRuntime,
  type ObservedResourceClaim,
  type ResourceProjectionRow,
} from '@compartment/kube-runtime';
import type { ResourceClaimIdentity } from '@compartment/contracts';
import { acknowledgeResourceReconcile, type CompartmentRequester } from '@compartment/sdk';
import { readLiveClaims, scaleDownAndAwaitTermination } from './worker-resource-reconcile-observation.service';
import type { CompleteResourceReconcileClaim } from './worker-resource-reconcile.service.types';

export async function executeManagedDelete(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  observation: KubeObservation,
  claimed: CompleteResourceReconcileClaim,
  row: ResourceProjectionRow,
): Promise<void> {
  const { leaseId, operationId } = claimed;
  try {
    await acknowledgeResourceReconcile(request, { leaseId, operationId, status: 'running' });
    await stopAndDeleteManagedManifests(runtime, observation, claimed, row);
    await acknowledgeResourceReconcile(request, { leaseId, operationId, status: 'succeeded' });
  } catch (error) {
    const failureMessage: string = error instanceof Error ? error.message : 'Resource reconcile failed.';
    await acknowledgeResourceReconcile(request, { failureMessage, leaseId, operationId, status: 'failed' });
    throw error;
  }
}

async function stopAndDeleteManagedManifests(
  runtime: KubeRuntime,
  observation: KubeObservation,
  claimed: CompleteResourceReconcileClaim,
  row: ResourceProjectionRow,
): Promise<void> {
  assertManagedClaimOwnership(claimed.expectedClaims, await readLiveClaims(runtime, row), row.deleteData);
  await scaleDownAndAwaitTermination(runtime, observation, row);
  assertManagedClaimOwnership(claimed.expectedClaims, await readLiveClaims(runtime, row), row.deleteData);
  await runtime.delete(projectResourceManifests(row, 0));
  if (row.deleteData) {
    await deleteManagedData(runtime, claimed.expectedClaims, row);
  }
}

async function deleteManagedData(
  runtime: KubeRuntime,
  expected: ResourceClaimIdentity[],
  row: ResourceProjectionRow,
): Promise<void> {
  const liveClaims: ObservedResourceClaim[] = assertRemainingResourceClaimOwnership(
    expected,
    await readLiveClaims(runtime, row),
  );
  if (liveClaims.length > 0) {
    await runtime.delete(projectResourceClaimDeleteTargets(row, liveClaims));
  }
}

function assertManagedClaimOwnership(
  expected: ResourceClaimIdentity[],
  observed: ObservedResourceClaim[],
  allowAbsent: boolean,
): void {
  if (allowAbsent) {
    assertRemainingResourceClaimOwnership(expected, observed);
    return;
  }
  assertResourceClaimOwnership(expected, observed);
}

function assertRemainingResourceClaimOwnership(
  expected: ResourceClaimIdentity[],
  observed: ObservedResourceClaim[],
): ObservedResourceClaim[] {
  assertSameResourceClaimHandles(expected, observed);
  const live: ObservedResourceClaim[] = observed.filter((claim: ObservedResourceClaim): boolean => claim.uid !== null);
  const expectedLive: ResourceClaimIdentity[] = expected.filter((claim: ResourceClaimIdentity): boolean =>
    live.some((candidate: ObservedResourceClaim): boolean => candidate.claimName === claim.claimName),
  );
  if (live.length === 0) {
    return live;
  }
  assertResourceClaimOwnership(expectedLive, live);
  return live;
}

function assertSameResourceClaimHandles(expected: ResourceClaimIdentity[], observed: ObservedResourceClaim[]): void {
  const expectedNames: Set<string> = new Set<string>(
    expected.map((claim: ResourceClaimIdentity): string => claim.claimName),
  );
  const observedNames: Set<string> = new Set<string>(
    observed.map((claim: ObservedResourceClaim): string => claim.claimName),
  );
  if (
    expected.length !== observed.length ||
    expectedNames.size !== observedNames.size ||
    [...expectedNames].some((name: string): boolean => !observedNames.has(name))
  ) {
    throw new Error('Resource reconcile refused: PVC handle mapping changed.');
  }
}
