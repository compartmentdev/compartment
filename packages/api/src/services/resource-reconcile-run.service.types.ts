import type { ProjectNetworkPolicyPorts, ResourceClaimIdentity, ResourceReconcileIntent } from '@compartment/contracts';

export interface ClaimedResourceReconcileResult {
  expectedClaims: ResourceClaimIdentity[];
  intent: ResourceReconcileIntent | null;
  operationId: string | null;
  leaseId: string | null;
  networkPolicy: ProjectNetworkPolicyPorts;
  previousManifestJson: string | null;
  type: 'bootstrap' | 'reconcile' | null;
}

export interface ResourceClaimIdentityWaitContext {
  deadlineAt: number;
  pollDelayMs: number;
}
