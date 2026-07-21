import type { ResourceClaimIdentity, ResourceReconcileIntent } from '@compartment/contracts';

export interface ClaimedResourceReconcileResult {
  expectedClaims: ResourceClaimIdentity[];
  intent: ResourceReconcileIntent | null;
  operationId: string | null;
  leaseId: string | null;
  previousManifestJson: string | null;
  type: 'bootstrap' | 'reconcile' | null;
}

export interface ResourceClaimIdentityWaitContext {
  deadlineAt: number;
  pollDelayMs: number;
}
