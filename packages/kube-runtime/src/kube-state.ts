import type {
  KubeDeploymentState,
  KubeDeploymentStateRow,
  KubeReconcileAction,
  KubeDriftKind,
  KubeDriftAudit,
  KubeObservedDeployment,
  KubeStateTransition,
} from './kube-state.types';
import type { KubeDeploymentCondition, KubeRolloutObservation, KubeRolloutStatus } from './kube-rollout.types';

export function calculateKubeRolloutStatus(observed: KubeRolloutObservation, now: Date): KubeRolloutStatus {
  if (
    observed.conditions.some(
      (condition: KubeDeploymentCondition): boolean =>
        condition.type === 'Progressing' &&
        condition.status === 'False' &&
        condition.reason === 'ProgressDeadlineExceeded',
    )
  ) {
    return 'progress-deadline-exceeded';
  }
  if (observed.observedGeneration === observed.generation && observed.availableReplicas >= observed.desiredReplicas) {
    return 'ready';
  }
  return now.getTime() >= observed.deadlineAt.getTime() ? 'timed-out' : 'progressing';
}

export function calculateKubeStateTransition(
  row: KubeDeploymentStateRow,
  observed: KubeObservedDeployment,
  now: Date,
): KubeStateTransition {
  if (row.state === 'desired') {
    return transition('apply', 'pending', null, row.observedAt);
  }
  const recovery: KubeStateTransition | null = recoveryTransition(row, observed);
  if (recovery !== null) {
    return recovery;
  }
  const ready: boolean = isReady(row, observed);
  if (ready) {
    return transition('none', 'active', null, now);
  }

  return transition(
    'none',
    'pending',
    driftAudit(row, 'non-ready', 'Active Kubernetes Deployment became non-Ready.'),
    row.observedAt,
  );
}

function isReady(row: KubeDeploymentStateRow, observed: KubeObservedDeployment): boolean {
  return (
    observed.generation !== null &&
    observed.observedGeneration === observed.generation &&
    observed.availableReplicas >= row.desiredReplicas
  );
}

function recoveryTransition(row: KubeDeploymentStateRow, observed: KubeObservedDeployment): KubeStateTransition | null {
  if (!observed.exists || !observed.requiredObjectsPresent) {
    return transition(
      'apply',
      'pending',
      driftAudit(row, 'deleted', 'A required Kubernetes application object is missing.'),
      row.observedAt,
    );
  }
  if (!observed.desiredFieldsDrifted) {
    return null;
  }
  return transition(
    'apply',
    'pending',
    driftAudit(row, 'drifted', 'Controller-owned Kubernetes fields drifted.'),
    row.observedAt,
  );
}

function driftAudit(row: KubeDeploymentStateRow, kind: KubeDriftKind, message: string): KubeDriftAudit | null {
  return row.state === 'active' ? { kind, message } : null;
}

function transition(
  action: KubeReconcileAction,
  nextState: KubeDeploymentState,
  audit: KubeDriftAudit | null,
  observedAt: Date | null,
): KubeStateTransition {
  return { action, audit, nextState, observedAt };
}
