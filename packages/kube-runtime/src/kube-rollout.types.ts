import type { V1ObjectMeta } from '@kubernetes/client-node';

export interface KubeDeploymentCondition {
  message?: string | undefined;
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
  message?: string | undefined;
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

export interface KubeObservedContainerStateRunning {
  startedAt?: string | undefined;
}

export interface KubeObservedContainerStateTerminated {
  startedAt?: string | undefined;
}

export interface KubeObservedContainerState {
  running?: KubeObservedContainerStateRunning | undefined;
  terminated?: KubeObservedContainerStateTerminated | undefined;
}

export interface KubeObservedContainerStatus {
  lastState?: KubeObservedContainerState | undefined;
  name?: string | undefined;
  state?: KubeObservedContainerState | undefined;
}

export interface KubeObservedPodStatus {
  containerStatuses?: KubeObservedContainerStatus[] | undefined;
}

export interface KubeObservedRolloutPod {
  kind: 'Pod';
  metadata?: V1ObjectMeta | undefined;
  status?: KubeObservedPodStatus | undefined;
}

export type KubeRolloutStatus = 'progress-deadline-exceeded' | 'progressing' | 'ready' | 'timed-out';
