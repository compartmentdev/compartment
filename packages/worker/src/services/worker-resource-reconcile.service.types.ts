import type { KubeManifest } from '@compartment/kube-runtime';

export interface ObservedClaimStatus {
  phase?: string | undefined;
}

export interface ObservedDeploymentCondition {
  status?: string | undefined;
  type?: string | undefined;
}

export interface ObservedDeploymentStatus {
  conditions?: ObservedDeploymentCondition[] | undefined;
  readyReplicas?: number | undefined;
}

export interface ManagedResourceUpdatePlan {
  desired: KubeManifest[];
  leaseId: string;
  operationId: string;
  rollback: KubeManifest[];
}
