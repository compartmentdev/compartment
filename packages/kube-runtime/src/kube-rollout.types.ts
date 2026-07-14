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

export type KubeRolloutStatus = 'progress-deadline-exceeded' | 'progressing' | 'ready' | 'timed-out';
