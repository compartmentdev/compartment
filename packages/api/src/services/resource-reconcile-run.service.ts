import type {
  ResourceClaimIdentity,
  ResourceReconcileIntent,
  WorkerAcknowledgeResourceReconcileRequest,
} from '@compartment/contracts';
import {
  acknowledgeResourceReconcileRun,
  claimResourceReconcileRun,
  createResourceReconcileRun,
  createResourceReconcileRunWithExecutor,
} from '../queries/resource-reconcile-runs.query';
import type { ClaimedResourceReconcileRun } from '../queries/resource-reconcile-runs.query.types';
import type { ProjectResourceRow, ResourceTransaction } from '../queries/resources.query.types';
import type { ClaimedResourceReconcileResult } from './resource-reconcile-run.service.types';

export async function requestResourceBootstrap(operationId: string, intent: ResourceReconcileIntent): Promise<void> {
  await createResourceReconcileRun({ expectedClaims: [], intent, operationId, type: 'bootstrap' });
}

export async function requestResourceReconcileWithExecutor(
  tx: ResourceTransaction,
  operationId: string,
  intent: ResourceReconcileIntent,
  resource: ProjectResourceRow,
): Promise<void> {
  const expectedClaims: ResourceClaimIdentity[] = JSON.parse(resource.expectedClaimsJson) as ResourceClaimIdentity[];
  if (intent.volumes.length > 0 && expectedClaims.length === 0) {
    throw new Error('Resource reconcile refused: expected PVC identity is missing. Bootstrap is required.');
  }
  await createResourceReconcileRunWithExecutor(tx, { expectedClaims, intent, operationId, type: 'reconcile' });
}

export async function claimNextResourceReconcile(): Promise<ClaimedResourceReconcileResult> {
  const claimed: ClaimedResourceReconcileRun | null = await claimResourceReconcileRun();
  return (
    claimed ?? {
      expectedClaims: [],
      intent: null,
      leaseId: null,
      operationId: null,
      previousManifestJson: null,
      type: null,
    }
  );
}

export async function acknowledgeResourceReconcile(input: WorkerAcknowledgeResourceReconcileRequest): Promise<void> {
  await acknowledgeResourceReconcileRun(input);
}
