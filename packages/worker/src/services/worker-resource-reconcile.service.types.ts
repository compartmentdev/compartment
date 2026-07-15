import type { WorkerClaimResourceReconcileResponse } from '@compartment/contracts';
import type { KubeManifest, ResourceProjectionRow } from '@compartment/kube-runtime';

export interface ObservedClaimStatus {
  phase?: string | undefined;
}

export interface ObservedDeploymentCondition {
  status?: string | undefined;
  type?: string | undefined;
}

export interface ObservedDeploymentStatus {
  availableReplicas?: number | undefined;
  conditions?: ObservedDeploymentCondition[] | undefined;
  observedGeneration?: number | undefined;
}

export interface ManagedResourceUpdatePlan {
  desired: KubeManifest[];
  leaseId: string;
  operationId: string;
  rollback: KubeManifest[] | null;
}

export interface CompleteResourceReconcileClaim extends Omit<
  WorkerClaimResourceReconcileResponse,
  'intent' | 'leaseId' | 'operationId' | 'type'
> {
  intent: ResourceProjectionRow;
  leaseId: string;
  operationId: string;
  type: 'bootstrap' | 'reconcile';
}
