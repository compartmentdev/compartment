import {
  assertResourceClaimOwnership,
  projectResourceClaimDeleteTargets,
  type KubeObservation,
  type KubeRuntime,
  type ObservedResourceClaim,
  type ResourceProjectionRow,
} from '@compartment/kube-runtime';
import { resourceReconcileLifecycleTimeoutMs, type ResourceClaimIdentity } from '@compartment/contracts';
import type { CompartmentRequester } from '@compartment/sdk';
import {
  projectManagedResourceManifests,
  readLiveClaims,
  scaleDownAndAwaitTermination,
} from './worker-resource-reconcile-observation.service';
import type { CompleteResourceReconcileClaim } from './worker-resource-reconcile.service.types';
import {
  acknowledgeCurrentResourceReconcile,
  rethrowResourceReconcileLeaseError,
  runWithResourceReconcileLease,
} from './worker-resource-reconcile-lease.service';
import { assertResourceReconcileActive } from './worker-resource-reconcile-wait.service';

export async function executeManagedDelete(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  observation: KubeObservation,
  claimed: CompleteResourceReconcileClaim,
  row: ResourceProjectionRow,
): Promise<void> {
  const { leaseId, operationId } = claimed;
  try {
    await acknowledgeCurrentResourceReconcile(request, { leaseId, operationId, status: 'running' });
    await runWithResourceReconcileLease(
      request,
      leaseId,
      operationId,
      async (signal: AbortSignal): Promise<void> =>
        await stopAndDeleteManagedManifests(runtime, observation, claimed, row, signal),
    );
    await acknowledgeCurrentResourceReconcile(request, { leaseId, operationId, status: 'succeeded' });
  } catch (error) {
    rethrowResourceReconcileLeaseError(typeof error === 'object' ? error : null);
    const failureMessage: string = error instanceof Error ? error.message : 'Resource reconcile failed.';
    await acknowledgeCurrentResourceReconcile(request, { failureMessage, leaseId, operationId, status: 'failed' });
    throw error;
  }
}

async function stopAndDeleteManagedManifests(
  runtime: KubeRuntime,
  observation: KubeObservation,
  claimed: CompleteResourceReconcileClaim,
  row: ResourceProjectionRow,
  signal: AbortSignal,
): Promise<void> {
  assertManagedClaimOwnership(claimed.expectedClaims, await readLiveClaims(runtime, row), row.deleteData);
  await scaleDownAndAwaitTermination(runtime, observation, row, signal);
  assertManagedClaimOwnership(claimed.expectedClaims, await readLiveClaims(runtime, row), row.deleteData);
  assertResourceReconcileActive(signal);
  await runtime.delete(projectManagedResourceManifests(row, 0, resourceReconcileLifecycleTimeoutMs));
  if (row.deleteData) {
    await deleteManagedData(runtime, claimed.expectedClaims, row, signal);
  }
}

async function deleteManagedData(
  runtime: KubeRuntime,
  expected: ResourceClaimIdentity[],
  row: ResourceProjectionRow,
  signal: AbortSignal,
): Promise<void> {
  const liveClaims: ObservedResourceClaim[] = assertRemainingResourceClaimOwnership(
    expected,
    await readLiveClaims(runtime, row),
  );
  if (liveClaims.length > 0) {
    assertResourceReconcileActive(signal);
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
