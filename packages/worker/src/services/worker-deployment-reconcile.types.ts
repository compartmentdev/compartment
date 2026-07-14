export interface ObservedDeploymentStatus {
  availableReplicas?: number | undefined;
  conditions?: ObservedDeploymentCondition[] | undefined;
  observedGeneration?: number | undefined;
  replicas?: number | undefined;
  updatedReplicas?: number | undefined;
}

export interface ObservedDeploymentCondition {
  reason?: string | undefined;
  status?: string | undefined;
  type?: string | undefined;
}
