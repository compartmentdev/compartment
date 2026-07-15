import type {
  ResourceClaimIdentity,
  ResourceReconcileIntent,
  WorkerAcknowledgeResourceReconcileRequest,
} from '@compartment/contracts';

export interface ClaimedResourceReconcileRun {
  expectedClaims: ResourceClaimIdentity[];
  intent: ResourceReconcileIntent;
  operationId: string;
  leaseId: string;
  previousManifestJson: string | null;
  type: 'bootstrap' | 'reconcile';
}

export interface CreateResourceReconcileRunInput {
  expectedClaims: ResourceClaimIdentity[];
  intent: ResourceReconcileIntent;
  operationId: string;
  type: 'bootstrap' | 'reconcile';
}

export type CreateResourceReconcileRunResult = 'created' | 'project-archived';

export interface ResourceReconcileRunState {
  failureMessage: string | null;
  phase: 'bootstrap-pending' | 'reconcile-pending' | 'running' | 'succeeded' | 'failed';
}

export interface ResourceReconcileRunLockRow {
  projectResourceId: string;
}

export interface ClaimableResourceReconcileRunLockRow {
  runId: string;
}

export interface ResourceReconcileProjectLockRow {
  archivedAt: Date | null;
}

export type AcknowledgeResourceReconcileRunInput = WorkerAcknowledgeResourceReconcileRequest;
