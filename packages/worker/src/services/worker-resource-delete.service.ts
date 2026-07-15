import {
  assertResourceClaimOwnership,
  projectResourceClaimDeleteTargets,
  projectResourceManifests,
  type KubeObservation,
  type KubeRuntime,
  type ObservedResourceClaim,
  type ResourceProjectionRow,
} from '@compartment/kube-runtime';
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
  const observedClaims: ObservedResourceClaim[] = readLiveClaims(observation, row);
  assertResourceClaimOwnership(claimed.expectedClaims, observedClaims);
  await scaleDownAndAwaitTermination(runtime, observation, row);
  assertResourceClaimOwnership(claimed.expectedClaims, readLiveClaims(observation, row));
  await runtime.delete(projectResourceManifests(row, 0));
  if (row.deleteData) {
    await runtime.delete(projectResourceClaimDeleteTargets(row, claimed.expectedClaims));
  }
}
