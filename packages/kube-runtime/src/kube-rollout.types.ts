export interface KubeDeploymentCondition {
  reason?: string | undefined;
  status: 'False' | 'True' | 'Unknown';
  type: string;
}

export interface KubeRolloutObservation {
  availableReplicas: number;
  conditions: readonly KubeDeploymentCondition[];
  deadlineAt: Date;
  desiredReplicas: number;
  generation: number;
  observedGeneration: number | null;
  replicas: number;
  updatedReplicas: number;
}

export interface KubeObservedDeploymentCondition {
  reason?: string | undefined;
  status?: string | undefined;
  type?: string | undefined;
}

export interface KubeObservedDeploymentStatus {
  availableReplicas?: number | undefined;
  conditions?: KubeObservedDeploymentCondition[] | undefined;
  observedGeneration?: number | undefined;
  replicas?: number | undefined;
  updatedReplicas?: number | undefined;
}

export type KubeRolloutStatus = 'progress-deadline-exceeded' | 'progressing' | 'ready' | 'timed-out';
