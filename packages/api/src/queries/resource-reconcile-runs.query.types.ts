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

export interface ResourceReconcileRunState {
  failureMessage: string | null;
  phase: 'bootstrap-pending' | 'reconcile-pending' | 'running' | 'succeeded' | 'failed';
}

export type AcknowledgeResourceReconcileRunInput = WorkerAcknowledgeResourceReconcileRequest;
