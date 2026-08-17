import type { ResourceClaimIdentity, WorkerClaimResourceReconcileResponse } from '@compartment/contracts';
import {
  kubeNamespaceName,
  projectResourceBootstrapClaims,
  type KubeManifest,
  type KubeDataWorkloadScheduling,
  type KubeObservation,
  type KubeRuntime,
  type KubeWorkloadScheduling,
  type ResourceProjectionRow,
} from '@compartment/kube-runtime';
import { acknowledgeResourceReconcile, type CompartmentRequester } from '@compartment/sdk';
import { readCreatedClaims } from './worker-resource-reconcile-observation.service';
import { waitUntil } from './worker-resource-reconcile-wait.service';
import { executeManagedDelete } from './worker-resource-delete.service';
import type { CompleteResourceReconcileClaim } from './worker-resource-reconcile.service.types';
import { applyProjectNetworkPolicies } from './worker-network-policy.service';
import { decryptTenantProjection } from '../tenant-workload-projections';
import type { TenantSecretsKeyring } from '../tenant-secret-environment.types';
import { executeManagedResourceUpdate } from './worker-resource-managed-update.service';

export async function executeResourceReconcile(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  claimed: WorkerClaimResourceReconcileResponse,
  tenantSecretsKek: TenantSecretsKeyring,
  infrastructureTimeoutMs: number,
  tenantScheduling: KubeWorkloadScheduling | undefined,
  dataScheduling: KubeDataWorkloadScheduling,
): Promise<void> {
  const complete: CompleteResourceReconcileClaim = requireCompleteClaim(claimed);
  const row: ResourceProjectionRow = {
    ...decryptTenantProjection(complete.intent, tenantScheduling, tenantSecretsKek),
    dataScheduling,
  };
  const observation: KubeObservation = await observeResource(runtime, row);
  try {
    if (row.operation !== 'delete') {
      await applyProjectNetworkPolicies(runtime, row.namespaceId, complete.networkPolicy);
    }
    await executeClaimedResource(request, runtime, observation, complete, row, infrastructureTimeoutMs);
    if (row.operation === 'delete') {
      await applyProjectNetworkPolicies(runtime, row.namespaceId, complete.networkPolicy);
    }
  } finally {
    await observation.stop();
  }
}

async function observeResource(runtime: KubeRuntime, row: ResourceProjectionRow): Promise<KubeObservation> {
  return await runtime.observe({
    labels: { 'compartment.dev/resource-id': row.resourceId },
    namespace: kubeNamespaceName(row.namespaceId),
    resources: ['deployments', 'persistentvolumeclaims', 'pods', 'secrets', 'services'],
  });
}

async function executeClaimedResource(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  observation: KubeObservation,
  claimed: CompleteResourceReconcileClaim,
  row: ResourceProjectionRow,
  infrastructureTimeoutMs: number,
): Promise<void> {
  if (claimed.type === 'bootstrap') {
    await executeBootstrap(request, runtime, observation, claimed.leaseId, claimed.operationId, row);
  } else if (row.operation === 'delete') {
    await executeManagedDelete(request, runtime, observation, claimed, row);
  } else {
    await executeManagedResourceUpdate(request, runtime, observation, claimed, row, infrastructureTimeoutMs);
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

function requireCompleteClaim(claimed: WorkerClaimResourceReconcileResponse): CompleteResourceReconcileClaim {
  if (claimed.intent === null || claimed.leaseId === null || claimed.operationId === null || claimed.type === null) {
    throw new Error('Claimed resource reconcile is incomplete.');
  }
  return claimed as CompleteResourceReconcileClaim;
}
