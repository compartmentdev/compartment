import type { ResourceClaimIdentity, WorkerClaimResourceReconcileResponse } from '@compartment/contracts';
import {
  assertResourceClaimOwnership,
  kubeNamespaceName,
  projectResourceBootstrapClaims,
  projectResourceManifests,
  type KubeManifest,
  type KubeObservation,
  type KubeRuntime,
  type ObservedResourceClaim,
  type ResourceProjectionRow,
} from '@compartment/kube-runtime';
import { acknowledgeResourceReconcile, type CompartmentRequester } from '@compartment/sdk';
import {
  assertFinalClaimState,
  readCreatedClaims,
  readLiveClaims,
  readResourcePods,
  readRollbackManifest,
  scaleDownAndAwaitTermination,
  waitUntil,
  waitForFreshResourceDeployment,
} from './worker-resource-reconcile-observation.service';
import { executeManagedDelete } from './worker-resource-delete.service';
import type {
  CompleteResourceReconcileClaim,
  ManagedResourceUpdatePlan,
} from './worker-resource-reconcile.service.types';

export async function executeResourceReconcile(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  claimed: WorkerClaimResourceReconcileResponse,
): Promise<void> {
  const complete: CompleteResourceReconcileClaim = requireCompleteClaim(claimed);
  const row: ResourceProjectionRow = complete.intent;
  const observation: KubeObservation = await runtime.observe({
    labels: { 'compartment.dev/resource-id': row.resourceId },
    namespace: kubeNamespaceName(row.namespaceId),
    resources: ['deployments', 'persistentvolumeclaims', 'pods', 'secrets', 'services'],
  });
  try {
    await executeClaimedResource(request, runtime, observation, complete, row);
  } finally {
    await observation.stop();
  }
}

async function executeClaimedResource(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  observation: KubeObservation,
  claimed: CompleteResourceReconcileClaim,
  row: ResourceProjectionRow,
): Promise<void> {
  if (claimed.type === 'bootstrap') {
    await executeBootstrap(request, runtime, observation, claimed.leaseId, claimed.operationId, row);
  } else if (row.operation === 'delete') {
    await executeManagedDelete(request, runtime, observation, claimed, row);
  } else {
    await executeManagedUpdate(request, runtime, observation, claimed, row);
  }
}

async function executeBootstrap(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  observation: KubeObservation,
  leaseId: string,
  operationId: string,
  row: ResourceProjectionRow,
): Promise<void> {
  const claims: KubeManifest[] = projectResourceBootstrapClaims(row);
  await runtime.apply({ objects: claims });
  const expectedClaims: ResourceClaimIdentity[] = await waitUntil(observation, (): ResourceClaimIdentity[] | null =>
    readCreatedClaims(observation, claims.length),
  );
  await acknowledgeResourceReconcile(request, { expectedClaims, leaseId, operationId, status: 'succeeded' });
}

async function executeManagedUpdate(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  observation: KubeObservation,
  claimed: CompleteResourceReconcileClaim,
  row: ResourceProjectionRow,
): Promise<void> {
  const plan: ManagedResourceUpdatePlan = await prepareManagedUpdateOrAcknowledgeFailure(
    request,
    observation,
    claimed,
    row,
  );
  try {
    await applyManagedResourceState(runtime, observation, claimed.expectedClaims, row, plan.desired);
    await acknowledgeManagedUpdateSuccess(request, plan);
  } catch (error) {
    const failure: object | null = typeof error === 'object' ? error : null;
    await recoverClaimedUpdate(request, runtime, observation, claimed, row, plan, failure);
    throw error;
  }
}

async function acknowledgeManagedUpdateSuccess(
  request: CompartmentRequester,
  plan: ManagedResourceUpdatePlan,
): Promise<void> {
  await acknowledgeResourceReconcile(request, {
    leaseId: plan.leaseId,
    operationId: plan.operationId,
    status: 'succeeded',
  });
}

async function prepareManagedUpdateOrAcknowledgeFailure(
  request: CompartmentRequester,
  observation: KubeObservation,
  claimed: CompleteResourceReconcileClaim,
  row: ResourceProjectionRow,
): Promise<ManagedResourceUpdatePlan> {
  try {
    return await prepareManagedUpdate(request, observation, claimed, row);
  } catch (error) {
    const failure: object | null = typeof error === 'object' ? error : null;
    await acknowledgeFailure(request, claimed.leaseId, claimed.operationId, readError(failure).message);
    throw error;
  }
}

async function recoverClaimedUpdate(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  observation: KubeObservation,
  claimed: CompleteResourceReconcileClaim,
  row: ResourceProjectionRow,
  plan: ManagedResourceUpdatePlan,
  error: object | null,
): Promise<void> {
  await acknowledgeResourceReconcile(request, {
    leaseId: plan.leaseId,
    operationId: plan.operationId,
    status: 'running',
  });
  await recoverFromFailedUpdate(request, runtime, observation, claimed, row, plan, readError(error));
}

async function prepareManagedUpdate(
  request: CompartmentRequester,
  observation: KubeObservation,
  claimed: CompleteResourceReconcileClaim,
  row: ResourceProjectionRow,
): Promise<ManagedResourceUpdatePlan> {
  const desired: KubeManifest[] = projectResourceManifests(row, row.replicas);
  const hasLivePods: boolean = readResourcePods(observation).length > 0;
  const plan: ManagedResourceUpdatePlan = {
    desired,
    leaseId: claimed.leaseId,
    operationId: claimed.operationId,
    rollback: readRollbackManifest(claimed.previousManifestJson, observation, desired, hasLivePods),
  };
  await acknowledgeResourceReconcile(request, {
    leaseId: plan.leaseId,
    operationId: plan.operationId,
    ...(plan.rollback === null ? {} : { previousManifestJson: JSON.stringify(plan.rollback) }),
    status: 'running',
  });
  return plan;
}

async function recoverFromFailedUpdate(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  observation: KubeObservation,
  claimed: CompleteResourceReconcileClaim,
  row: ResourceProjectionRow,
  plan: ManagedResourceUpdatePlan,
  originalError: Error,
): Promise<void> {
  try {
    await recoverResourceState(runtime, observation, claimed.expectedClaims, row, plan.rollback);
    await acknowledgeFailure(request, plan.leaseId, plan.operationId, originalError.message);
  } catch (rollbackError) {
    const failure: Error = readError(typeof rollbackError === 'object' ? rollbackError : null);
    await acknowledgeFailure(
      request,
      plan.leaseId,
      plan.operationId,
      `${originalError.message} Rollback failed: ${failure.message}`,
    );
  }
}

async function recoverResourceState(
  runtime: KubeRuntime,
  observation: KubeObservation,
  expectedClaims: ResourceClaimIdentity[],
  row: ResourceProjectionRow,
  rollback: KubeManifest[] | null,
): Promise<void> {
  if (rollback !== null) {
    await applyManagedResourceState(runtime, observation, expectedClaims, row, rollback);
    return;
  }
  await scaleDownAndAwaitTermination(runtime, observation, row);
}

async function applyManagedResourceState(
  runtime: KubeRuntime,
  observation: KubeObservation,
  expectedClaims: ResourceClaimIdentity[],
  row: ResourceProjectionRow,
  manifests: KubeManifest[],
): Promise<void> {
  const observedClaims: ObservedResourceClaim[] = readLiveClaims(observation, row);
  assertResourceClaimOwnership(expectedClaims, observedClaims);
  await scaleDownAndAwaitTermination(runtime, observation, row);
  await runtime.apply({ objects: manifests });
  await waitForFreshResourceDeployment(observation, manifests);
  assertFinalClaimState(expectedClaims, readLiveClaims(observation, row), row);
}

async function acknowledgeFailure(
  request: CompartmentRequester,
  leaseId: string,
  operationId: string,
  failureMessage: string,
): Promise<void> {
  await acknowledgeResourceReconcile(request, {
    failureMessage,
    leaseId,
    operationId,
    status: 'failed',
  });
}

function requireCompleteClaim(claimed: WorkerClaimResourceReconcileResponse): CompleteResourceReconcileClaim {
  if (claimed.intent === null || claimed.leaseId === null || claimed.operationId === null || claimed.type === null) {
    throw new Error('Claimed resource reconcile is incomplete.');
  }
  return claimed as CompleteResourceReconcileClaim;
}

function readError(error: object | null): Error {
  return error instanceof Error ? error : new Error('Resource reconcile failed.');
}
