export type KubeDeploymentState = 'desired' | 'pending' | 'active';

export interface KubeDeploymentStateRow {
  desiredReplicas: number;
  observedAt: Date | null;
  state: KubeDeploymentState;
}

export interface KubeObservedDeployment {
  availableReplicas: number;
  desiredFieldsDrifted: boolean;
  exists: boolean;
  generation: number | null;
  observedGeneration: number | null;
  requiredObjectsPresent: boolean;
}

export type KubeReconcileAction = 'apply' | 'none';
export type KubeDriftKind = 'deleted' | 'drifted' | 'non-ready';

export interface KubeStateTransition {
  action: KubeReconcileAction;
  audit: KubeDriftAudit | null;
  nextState: KubeDeploymentState;
  observedAt: Date | null;
}

export interface KubeDriftAudit {
  kind: KubeDriftKind;
  message: string;
}
