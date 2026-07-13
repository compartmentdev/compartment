import type { ResourceClaimIdentity, WorkerClaimResourceReconcileResponse } from '@compartment/contracts';
import {
  assertResourceClaimOwnership,
  kubeNamespaceName,
  projectResourceBootstrapClaims,
  projectResourceManifests,
  resourcePodsFullyTerminated,
  type KubeDeploymentManifest,
  type KubeManifest,
  type KubeObservation,
  type KubeRuntime,
  type ResourceProjectionRow,
} from '@compartment/kube-runtime';
import { acknowledgeResourceReconcile, type CompartmentRequester } from '@compartment/sdk';
import {
  assertFinalClaimState,
  readCreatedClaims,
  readObservedClaims,
  readResourcePods,
  readRollbackManifest,
  resourceDeploymentFreshAndReady,
  waitUntil,
  waitUntilLive,
} from './worker-resource-reconcile-observation.service';
import type { ManagedResourceUpdatePlan } from './worker-resource-reconcile.service.types';

export async function executeResourceReconcile(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  claimed: WorkerClaimResourceReconcileResponse,
): Promise<void> {
  if (claimed.intent === null || claimed.leaseId === null || claimed.operationId === null || claimed.type === null) {
    throw new Error('Claimed resource reconcile is incomplete.');
  }
  const row: ResourceProjectionRow = claimed.intent;
  const observation: KubeObservation = await runtime.observe({
    labels: { 'compartment.dev/resource-id': row.resourceId },
    namespace: kubeNamespaceName(row.namespaceId),
    resources: ['deployments', 'persistentvolumeclaims', 'pods', 'secrets', 'services'],
  });
  try {
    if (claimed.type === 'bootstrap') {
      await executeBootstrap(request, runtime, observation, claimed.leaseId, claimed.operationId, row);
      return;
    }
    await executeManagedUpdate(request, runtime, observation, claimed, row);
  } finally {
    await observation.stop();
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
  claimed: WorkerClaimResourceReconcileResponse,
  row: ResourceProjectionRow,
): Promise<void> {
  const plan: ManagedResourceUpdatePlan = await prepareManagedUpdate(request, runtime, observation, claimed, row);
  try {
    await applyManagedResourceState(runtime, observation, claimed.expectedClaims, row, plan.desired);
    await acknowledgeSuccess(request, plan);
  } catch (error) {
    await recoverClaimedUpdate(
      request,
      runtime,
      observation,
      claimed,
      row,
      plan,
      typeof error === 'object' ? error : null,
    );
    throw error;
  }
}

async function recoverClaimedUpdate(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  observation: KubeObservation,
  claimed: WorkerClaimResourceReconcileResponse,
  row: ResourceProjectionRow,
  plan: ManagedResourceUpdatePlan,
  error: object | null,
): Promise<void> {
  await renewResourceReconcileLease(request, plan.leaseId, plan.operationId);
  await recoverFromFailedUpdate(
    request,
    runtime,
    observation,
    claimed.expectedClaims,
    row,
    plan.rollback,
    plan.leaseId,
    plan.operationId,
    readError(error),
  );
}

async function renewResourceReconcileLease(
  request: CompartmentRequester,
  leaseId: string,
  operationId: string,
): Promise<void> {
  await acknowledgeResourceReconcile(request, { leaseId, operationId, status: 'running' });
}

async function acknowledgeSuccess(request: CompartmentRequester, plan: ManagedResourceUpdatePlan): Promise<void> {
  await acknowledgeResourceReconcile(request, {
    leaseId: plan.leaseId,
    operationId: plan.operationId,
    status: 'succeeded',
  });
}

async function prepareManagedUpdate(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  observation: KubeObservation,
  claimed: WorkerClaimResourceReconcileResponse,
  row: ResourceProjectionRow,
): Promise<ManagedResourceUpdatePlan> {
  const desired: KubeManifest[] = projectResourceManifests(row);
  const plan: ManagedResourceUpdatePlan = {
    desired,
    leaseId: requiredLeaseId(claimed.leaseId),
    operationId: requiredOperationId(claimed.operationId),
    rollback: await readRollbackManifest(claimed.previousManifestJson, runtime, desired),
  };
  assertResourceClaimOwnership(claimed.expectedClaims, readObservedClaims(observation));
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
  expectedClaims: ResourceClaimIdentity[],
  row: ResourceProjectionRow,
  rollback: KubeManifest[] | null,
  leaseId: string,
  operationId: string,
  originalError: Error,
): Promise<void> {
  try {
    await recoverResourceState(runtime, observation, expectedClaims, row, rollback);
    await acknowledgeFailure(request, leaseId, operationId, originalError.message);
  } catch (rollbackError) {
    const failure: Error = readError(typeof rollbackError === 'object' ? rollbackError : null);
    await acknowledgeFailure(
      request,
      leaseId,
      operationId,
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
  await runtime.apply({ objects: projectResourceManifests(row, 0) });
  await waitUntil(observation, (): true | null =>
    resourcePodsFullyTerminated(readResourcePods(observation)) ? true : null,
  );
}

async function applyManagedResourceState(
  runtime: KubeRuntime,
  observation: KubeObservation,
  expectedClaims: ResourceClaimIdentity[],
  row: ResourceProjectionRow,
  manifests: KubeManifest[],
): Promise<void> {
  await runtime.apply({ objects: projectResourceManifests(row, 0) });
  await waitUntil(observation, (): true | null =>
    resourcePodsFullyTerminated(readResourcePods(observation)) ? true : null,
  );
  assertResourceClaimOwnership(expectedClaims, readObservedClaims(observation));
  await runtime.apply({ objects: manifests });
  const desiredDeployment: KubeDeploymentManifest = requiredDeployment(manifests);
  await waitUntilLive(
    async (): Promise<true | null> =>
      resourceDeploymentFreshAndReady(await runtime.read(desiredDeployment), desiredDeployment) ? true : null,
  );
  assertFinalClaimState(expectedClaims, readObservedClaims(observation), row);
}

function requiredDeployment(manifests: KubeManifest[]): KubeDeploymentManifest {
  const deployment: KubeManifest | undefined = manifests.find(
    (manifest: KubeManifest): boolean => manifest.kind === 'Deployment',
  );
  if (deployment?.kind !== 'Deployment') {
    throw new Error('Resource reconcile Deployment manifest is missing.');
  }
  return deployment;
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

function requiredOperationId(operationId: string | null): string {
  if (operationId === null) {
    throw new Error('Resource reconcile operation ID is missing.');
  }
  return operationId;
}

function requiredLeaseId(leaseId: string | null): string {
  if (leaseId === null) {
    throw new Error('Resource reconcile lease ID is missing.');
  }
  return leaseId;
}

function readError(error: object | null): Error {
  return error instanceof Error ? error : new Error('Resource reconcile failed.');
}
