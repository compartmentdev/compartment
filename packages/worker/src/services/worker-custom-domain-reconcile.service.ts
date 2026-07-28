import type {
  CustomDomainReconcileTarget,
  WorkerClaimCustomDomainReconcileResponse,
  WorkerCustomDomainReconcileMutationResponse,
  WorkerObserveCustomDomainReconcileRequest,
} from '@compartment/contracts';
import {
  observeCustomDomainProjection,
  projectCustomDomainManifests,
  type CustomDomainProjectionObservation,
  type CustomDomainProjectionRow,
  type KubeManifest,
  type KubeObservedManifest,
  type KubeRuntime,
} from '@compartment/kube-runtime';
import {
  completeCustomDomainReconcile,
  failCustomDomainReconcile,
  observeCustomDomainReconcile,
  type CompartmentRequester,
} from '@compartment/sdk';
import type { WorkerCustomDomainConfig } from '../config';
import type { WorkerCaughtError } from '../logging/worker-error-log.types';

export async function executeCustomDomainReconcile(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  claim: WorkerClaimCustomDomainReconcileResponse,
  config: WorkerCustomDomainConfig,
): Promise<void> {
  if (claim.target === null || claim.leaseId === null) {
    return;
  }
  try {
    await executeClaimedOperation(request, runtime, claim.target, claim.leaseId, config);
  } catch (error) {
    if (claim.target.operation === 'reconcile') {
      await failCustomDomainReconcile(request, {
        failureMessage: readFailureMessage(error as WorkerCaughtError),
        leaseId: claim.leaseId,
        observedGeneration: claim.target.desiredGeneration,
      });
      return;
    }
    throw error;
  }
}

async function executeClaimedOperation(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  target: CustomDomainReconcileTarget,
  leaseId: string,
  config: WorkerCustomDomainConfig,
): Promise<void> {
  const projection: CustomDomainProjectionRow = buildProjection(target, config);
  const manifests: KubeManifest[] = projectCustomDomainManifests(projection);
  if (!(await validateLeaseBeforeMutation(request, runtime, target, leaseId, manifests))) {
    return;
  }
  await applyCustomDomainOperation(runtime, target, manifests);
  await observeAndCompleteOperation(request, runtime, target, leaseId, manifests);
}

async function observeAndCompleteOperation(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  target: CustomDomainReconcileTarget,
  leaseId: string,
  manifests: KubeManifest[],
): Promise<void> {
  const observation: WorkerObserveCustomDomainReconcileRequest = await observeProjectedObjects(
    runtime,
    target,
    leaseId,
    manifests,
  );
  observation.releaseLease = !isOperationSettled(target, observation);
  await observeCustomDomainReconcile(request, observation);
  if (isOperationSettled(target, observation)) {
    await completeCustomDomainReconcile(request, {
      leaseId,
      observedGeneration: target.desiredGeneration,
    });
  }
}

async function validateLeaseBeforeMutation(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  target: CustomDomainReconcileTarget,
  leaseId: string,
  manifests: KubeManifest[],
): Promise<boolean> {
  const observation: WorkerObserveCustomDomainReconcileRequest = await observeProjectedObjects(
    runtime,
    target,
    leaseId,
    manifests,
  );
  observation.releaseLease = false;
  const result: WorkerCustomDomainReconcileMutationResponse = await observeCustomDomainReconcile(request, observation);
  return result.applied;
}

async function applyCustomDomainOperation(
  runtime: KubeRuntime,
  target: CustomDomainReconcileTarget,
  manifests: KubeManifest[],
): Promise<void> {
  if (target.operation === 'delete') {
    await runtime.delete(manifests);
  } else {
    await runtime.apply({ objects: manifests });
  }
}

async function observeProjectedObjects(
  runtime: KubeRuntime,
  target: CustomDomainReconcileTarget,
  leaseId: string,
  manifests: KubeManifest[],
): Promise<WorkerObserveCustomDomainReconcileRequest> {
  const [ingress, certificate]: [KubeObservedManifest | null, KubeObservedManifest | null] = await Promise.all([
    runtime.read(manifests[0]!),
    runtime.read(manifests[1]!),
  ]);
  const projection: CustomDomainProjectionObservation = observeCustomDomainProjection(manifests, ingress, certificate);
  return {
    certificatePresent: target.operation === 'delete' ? certificate !== null : projection.certificatePresent,
    certificateReady: target.operation === 'delete' ? false : projection.certificateReady,
    ingressPresent: target.operation === 'delete' ? ingress !== null : projection.ingressPresent,
    leaseId,
    observedGeneration: target.desiredGeneration,
    releaseLease: false,
  };
}

function buildProjection(
  target: CustomDomainReconcileTarget,
  config: WorkerCustomDomainConfig,
): CustomDomainProjectionRow {
  return {
    ...config,
    domainId: target.domainId,
    host: target.host,
  };
}

function isOperationSettled(
  target: CustomDomainReconcileTarget,
  observation: WorkerObserveCustomDomainReconcileRequest,
): boolean {
  if (target.operation === 'delete') {
    return !observation.ingressPresent && !observation.certificatePresent;
  }
  return observation.ingressPresent && observation.certificatePresent && observation.certificateReady;
}

function readFailureMessage(error: WorkerCaughtError): string {
  return error instanceof Error ? error.message : 'Custom domain reconciliation failed.';
}
