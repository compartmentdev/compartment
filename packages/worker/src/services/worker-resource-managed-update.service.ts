import type { ResourceClaimIdentity } from '@compartment/contracts';
import {
  assertResourceClaimOwnership,
  type KubeManifest,
  type KubeObservation,
  type KubeRuntime,
  type ObservedResourceClaim,
  type ResourceProjectionRow,
} from '@compartment/kube-runtime';
import type { CompartmentRequester } from '@compartment/sdk';
import {
  assertFinalClaimState,
  projectManagedResourceManifests,
  readLiveClaims,
  readResourcePods,
  readRollbackManifest,
  scaleDownAndAwaitTermination,
  waitForMountedResourceClaims,
} from './worker-resource-reconcile-observation.service';
import {
  assertResourceReconcileActive,
  waitForFreshResourceDeployment,
} from './worker-resource-reconcile-wait.service';
import type {
  CompleteResourceReconcileClaim,
  ManagedResourceUpdatePlan,
} from './worker-resource-reconcile.service.types';
import {
  acknowledgeCurrentResourceReconcile,
  rethrowResourceReconcileLeaseError,
  runWithResourceReconcileLease,
} from './worker-resource-reconcile-lease.service';

export async function executeManagedResourceUpdate(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  observation: KubeObservation,
  claimed: CompleteResourceReconcileClaim,
  row: ResourceProjectionRow,
  infrastructureTimeoutMs: number,
): Promise<void> {
  const plan: ManagedResourceUpdatePlan = await prepareManagedUpdateOrAcknowledgeFailure(
    request,
    runtime,
    observation,
    claimed,
    row,
    infrastructureTimeoutMs,
  );
  try {
    await runWithResourceReconcileLease(
      request,
      plan.leaseId,
      plan.operationId,
      async (signal: AbortSignal): Promise<void> =>
        await applyManagedResourceState(
          runtime,
          observation,
          claimed.expectedClaims,
          row,
          plan.desired,
          infrastructureTimeoutMs,
          signal,
        ),
    );
    await acknowledgeCurrentResourceReconcile(request, {
      leaseId: plan.leaseId,
      operationId: plan.operationId,
      status: 'succeeded',
    });
  } catch (error) {
    const failure: object | null = typeof error === 'object' ? error : null;
    rethrowResourceReconcileLeaseError(failure);
    await recoverClaimedUpdate(request, runtime, observation, claimed, row, plan, failure, infrastructureTimeoutMs);
    throw error;
  }
}

async function prepareManagedUpdateOrAcknowledgeFailure(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  observation: KubeObservation,
  claimed: CompleteResourceReconcileClaim,
  row: ResourceProjectionRow,
  infrastructureTimeoutMs: number,
): Promise<ManagedResourceUpdatePlan> {
  try {
    return await prepareManagedUpdate(request, runtime, observation, claimed, row, infrastructureTimeoutMs);
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
  infrastructureTimeoutMs: number,
): Promise<void> {
  await acknowledgeCurrentResourceReconcile(request, {
    leaseId: plan.leaseId,
    operationId: plan.operationId,
    status: 'running',
  });
  await runWithResourceReconcileLease(
    request,
    plan.leaseId,
    plan.operationId,
    async (signal: AbortSignal): Promise<void> =>
      await recoverFromFailedUpdate(
        request,
        runtime,
        observation,
        claimed,
        row,
        plan,
        readError(error),
        infrastructureTimeoutMs,
        signal,
      ),
  );
}

async function prepareManagedUpdate(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  observation: KubeObservation,
  claimed: CompleteResourceReconcileClaim,
  row: ResourceProjectionRow,
  infrastructureTimeoutMs: number,
): Promise<ManagedResourceUpdatePlan> {
  assertResourceClaimOwnership(claimed.expectedClaims, await readLiveClaims(runtime, row));
  const desired: KubeManifest[] = projectManagedResourceManifests(row, row.replicas, infrastructureTimeoutMs);
  const hasLivePods: boolean = readResourcePods(observation).length > 0;
  const plan: ManagedResourceUpdatePlan = {
    desired,
    leaseId: claimed.leaseId,
    operationId: claimed.operationId,
    rollback: readRollbackManifest(claimed.previousManifestJson, observation, desired, row, hasLivePods),
  };
  await acknowledgeCurrentResourceReconcile(request, {
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
  infrastructureTimeoutMs: number,
  signal: AbortSignal,
): Promise<void> {
  try {
    await recoverResourceState(
      runtime,
      observation,
      claimed.expectedClaims,
      row,
      plan.rollback,
      infrastructureTimeoutMs,
      signal,
    );
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
  infrastructureTimeoutMs: number,
  signal: AbortSignal,
): Promise<void> {
  if (rollback !== null) {
    await applyManagedResourceState(
      runtime,
      observation,
      expectedClaims,
      row,
      rollback,
      infrastructureTimeoutMs,
      signal,
    );
    return;
  }
  await scaleDownAndAwaitTermination(runtime, observation, row, signal);
}

async function applyManagedResourceState(
  runtime: KubeRuntime,
  observation: KubeObservation,
  expectedClaims: ResourceClaimIdentity[],
  row: ResourceProjectionRow,
  manifests: KubeManifest[],
  infrastructureTimeoutMs: number,
  signal: AbortSignal,
): Promise<void> {
  const observedClaims: ObservedResourceClaim[] = await readLiveClaims(runtime, row);
  assertResourceClaimOwnership(expectedClaims, observedClaims);
  assertResourceReconcileActive(signal);
  await scaleDownAndAwaitTermination(runtime, observation, row, signal);
  assertResourceClaimOwnership(expectedClaims, await readLiveClaims(runtime, row));
  assertResourceReconcileActive(signal);
  const applied: KubeManifest[] = await runtime.apply({ objects: manifests });
  await waitForMountedResourceClaims(observation, expectedClaims, row, applied, infrastructureTimeoutMs, signal);
  await waitForFreshResourceDeployment(observation, applied, infrastructureTimeoutMs, signal);
  assertFinalClaimState(expectedClaims, await readLiveClaims(runtime, row), row);
}

async function acknowledgeFailure(
  request: CompartmentRequester,
  leaseId: string,
  operationId: string,
  failureMessage: string,
): Promise<void> {
  await acknowledgeCurrentResourceReconcile(request, { failureMessage, leaseId, operationId, status: 'failed' });
}

function readError(error: object | null): Error {
  return error instanceof Error ? error : new Error('Resource reconcile failed.');
}
