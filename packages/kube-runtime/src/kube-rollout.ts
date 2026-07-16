import type { KubeDeploymentManifest, KubeObservedManifest } from './kube-runtime.types';
import type {
  KubeDeploymentCondition,
  KubeObservedDeploymentCondition,
  KubeObservedDeploymentStatus,
  KubeRolloutObservation,
  KubeRolloutStatus,
} from './kube-rollout.types';

export function readKubeRolloutObservation(
  observed: KubeObservedManifest | null,
  deployment: KubeDeploymentManifest,
  deadlineAt: Date,
): KubeRolloutObservation | null {
  const appliedUid: string | undefined = deployment.metadata?.uid;
  const appliedGeneration: number | undefined = deployment.metadata?.generation;
  const status: KubeObservedDeploymentStatus = observed?.status ?? {};
  if (!matchesAppliedDeployment(observed, status, appliedUid, appliedGeneration)) {
    return null;
  }
  return {
    availableReplicas: status.availableReplicas ?? 0,
    conditions: (status.conditions ?? []).map(projectDeploymentCondition),
    deadlineAt,
    desiredReplicas: deployment.spec?.replicas ?? 1,
    generation: appliedGeneration,
    observedGeneration: appliedGeneration,
    replicas: status.replicas ?? 0,
    updatedReplicas: status.updatedReplicas ?? 0,
  };
}

function matchesAppliedDeployment(
  observed: KubeObservedManifest | null,
  status: KubeObservedDeploymentStatus,
  appliedUid: string | undefined,
  appliedGeneration: number | undefined,
): appliedGeneration is number {
  return (
    appliedUid !== undefined &&
    appliedGeneration !== undefined &&
    observed?.kind === 'Deployment' &&
    observed.metadata?.uid === appliedUid &&
    observed.metadata.generation === appliedGeneration &&
    status.observedGeneration === appliedGeneration
  );
}

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

function projectDeploymentCondition(condition: KubeObservedDeploymentCondition): KubeDeploymentCondition {
  return {
    reason: condition.reason ?? '',
    status: condition.status === 'False' || condition.status === 'True' ? condition.status : 'Unknown',
    type: condition.type ?? '',
  };
}
