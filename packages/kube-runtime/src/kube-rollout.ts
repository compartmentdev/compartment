import { kubeApplicationName } from './kube-naming';
import type { KubeDeploymentManifest, KubeObservedManifest } from './kube-runtime.types';
import type {
  KubeDeploymentCondition,
  KubeObservedContainerStatus,
  KubeObservedDeploymentCondition,
  KubeObservedDeploymentStatus,
  KubeObservedRolloutPod,
  KubeRolloutObservation,
  KubeRolloutStatus,
} from './kube-rollout.types';

const deploymentIdLabel: string = 'compartment.dev/deployment-id';

export function readKubeApplicationRunningStartedAt(
  observed: Iterable<KubeObservedManifest>,
  deploymentId: string,
): Date | null {
  return readKubeContainerStartedAt(
    observed,
    { [deploymentIdLabel]: deploymentId },
    kubeApplicationName(deploymentId),
    true,
  );
}

export function readKubeContainerRunningStartedAt(
  observed: Iterable<KubeObservedManifest>,
  labels: Readonly<Record<string, string>>,
  containerName: string,
): Date | null {
  return readKubeContainerStartedAt(observed, labels, containerName, false);
}

function readKubeContainerStartedAt(
  observed: Iterable<KubeObservedManifest>,
  labels: Readonly<Record<string, string>>,
  containerName: string,
  retainTerminatedStart: boolean,
): Date | null {
  const startedAt: number[] = [...observed].flatMap((manifest: KubeObservedManifest): number[] =>
    readPodContainerStartedAt(manifest, labels, containerName, retainTerminatedStart),
  );
  return startedAt.length === 0 ? null : new Date(Math.min(...startedAt));
}

function readPodContainerStartedAt(
  manifest: KubeObservedManifest,
  labels: Readonly<Record<string, string>>,
  containerName: string,
  retainTerminatedStart: boolean,
): number[] {
  if (manifest.kind !== 'Pod' || !hasLabels(manifest.metadata?.labels, labels)) {
    return [];
  }
  const pod: KubeObservedRolloutPod = manifest;
  const container: KubeObservedContainerStatus | undefined = pod.status?.containerStatuses?.find(
    (status: KubeObservedContainerStatus): boolean => status.name === containerName,
  );
  return container === undefined ? [] : validStartedAt(container, retainTerminatedStart);
}

function hasLabels(observed: Record<string, string> | undefined, expected: Readonly<Record<string, string>>): boolean {
  return (
    observed !== undefined &&
    Object.entries(expected).every(([key, value]: [string, string]) => observed[key] === value)
  );
}

function validStartedAt(container: KubeObservedContainerStatus, retainTerminatedStart: boolean): number[] {
  const previousStartedAt: string | undefined = retainTerminatedStart
    ? container.lastState?.terminated?.startedAt
    : undefined;
  return [container.state?.running?.startedAt, previousStartedAt].flatMap((value: string | undefined): number[] => {
    const timestamp: number = value === undefined ? Number.NaN : Date.parse(value);
    return Number.isNaN(timestamp) ? [] : [timestamp];
  });
}

/**
 * Live availability of an observed Deployment: the current generation is observed and every desired
 * replica belongs to that generation and passed its readiness probe. Replicas left over from a previous
 * generation do not count, so a Recreate rollout is unavailable until its replacement Pod is ready.
 * A Deployment scaled to zero is never available.
 */
export function kubeDeploymentAvailable(observed: KubeObservedManifest | null): boolean {
  if (observed?.kind !== 'Deployment') {
    return false;
  }
  const status: KubeObservedDeploymentStatus = observed.status ?? {};
  const desiredReplicas: number = observed.spec?.replicas ?? 0;
  const generation: number | undefined = observed.metadata?.generation;
  if (generation === undefined || desiredReplicas < 1 || status.observedGeneration !== generation) {
    return false;
  }
  return (
    status.updatedReplicas === desiredReplicas &&
    status.replicas === desiredReplicas &&
    (status.availableReplicas ?? 0) >= desiredReplicas
  );
}

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
    ...(condition.message === undefined ? {} : { message: condition.message }),
    reason: condition.reason ?? '',
    status: condition.status === 'False' || condition.status === 'True' ? condition.status : 'Unknown',
    type: condition.type ?? '',
  };
}
