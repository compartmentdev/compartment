import type { ResourceReconcileIntent, WorkerClaimResourceReconcileResponse } from '@compartment/contracts';
import type { KubeManifest } from '@compartment/kube-runtime';

export interface ManagedResourceUpdatePlan {
  desired: KubeManifest[];
  leaseId: string;
  operationId: string;
  rollback: KubeManifest[] | null;
}

export type ResourceReconcileWork = (signal: AbortSignal) => Promise<void>;

export interface CompleteResourceReconcileClaim extends Omit<
  WorkerClaimResourceReconcileResponse,
  'intent' | 'leaseId' | 'operationId' | 'type'
> {
  intent: ResourceReconcileIntent;
  leaseId: string;
  operationId: string;
  type: 'bootstrap' | 'reconcile';
}
