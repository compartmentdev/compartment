import type { WorkerClaimResourceReconcileResponse } from '@compartment/contracts';
import {
  assertResourceClaimOwnership,
  projectResourceBootstrapClaims,
  projectResourceManifests,
  resourcePodsFullyTerminated,
  type KubeObservation,
  type KubeRuntime,
  type ResourceProjectionRow,
} from '@compartment/kube-runtime';
import { acknowledgeResourceReconcile, type CompartmentRequester } from '@compartment/sdk';
import { readLiveClaims, readResourcePods, waitUntil } from './worker-resource-reconcile-observation.service';

export async function executeManagedDelete(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  observation: KubeObservation,
  claimed: WorkerClaimResourceReconcileResponse,
  row: ResourceProjectionRow,
): Promise<void> {
  const leaseId: string = requiredValue(claimed.leaseId, 'lease ID');
  const operationId: string = requiredValue(claimed.operationId, 'operation ID');
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
  claimed: WorkerClaimResourceReconcileResponse,
  row: ResourceProjectionRow,
): Promise<void> {
  await runtime.apply({ objects: projectResourceManifests(row, 0) });
  await waitUntil(observation, (): true | null =>
    resourcePodsFullyTerminated(readResourcePods(observation)) ? true : null,
  );
  assertResourceClaimOwnership(claimed.expectedClaims, await readLiveClaims(runtime, row));
  await runtime.delete(projectResourceManifests(row, 0));
  if (row.deleteData) {
    await runtime.delete(projectResourceBootstrapClaims(row));
  }
}

function requiredValue(value: string | null, name: string): string {
  if (value === null) {
    throw new Error(`Resource reconcile ${name} is missing.`);
  }
  return value;
}
