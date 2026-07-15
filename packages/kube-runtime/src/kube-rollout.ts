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
  if (
    observed.observedGeneration === observed.generation &&
    observed.updatedReplicas === observed.desiredReplicas &&
    observed.replicas === observed.desiredReplicas &&
    observed.availableReplicas >= observed.desiredReplicas
  ) {
    return 'ready';
  }
  return now.getTime() >= observed.deadlineAt.getTime() ? 'timed-out' : 'progressing';
}
