import type { DeploymentReconcileProjection, DeploymentReconcileTarget } from '@compartment/contracts';
import {
  type KubeDeploymentCondition,
  type KubeDeploymentManifest,
  type KubeObservedManifest,
  type KubeRolloutObservation,
} from '@compartment/kube-runtime';
import { deploymentConditionStatus } from './worker-deployment-reconcile.helpers';
import type { ObservedDeploymentCondition, ObservedDeploymentStatus } from './worker-deployment-reconcile.types';

const defaultRolloutTimeoutMs: number = 50_000;

export function readRolloutObservation(
  observed: KubeObservedManifest | null,
  deployment: KubeDeploymentManifest,
  target: DeploymentReconcileTarget,
): KubeRolloutObservation | null {
  const startedAt: number = new Date(target.rolloutStartedAt).getTime();
  const deadlineAt: Date = new Date(startedAt + rolloutTimeoutMs(target.candidate));
  return projectDeploymentObservation(observed, deployment, deadlineAt);
}

export function rolloutTimeoutMs(projection: DeploymentReconcileProjection): number {
  return projection.readiness?.timeoutMs ?? defaultRolloutTimeoutMs;
}

function projectDeploymentObservation(
  observed: KubeObservedManifest | null,
  deployment: KubeDeploymentManifest,
  deadlineAt: Date,
): KubeRolloutObservation | null {
  const appliedUid: string | undefined = deployment.metadata?.uid;
  const appliedGeneration: number | undefined = deployment.metadata?.generation;
  if (appliedUid === undefined || appliedGeneration === undefined) {
    return null;
  }
  if (!deploymentMatchesApply(observed, appliedUid, appliedGeneration)) {
    return null;
  }
  const status: ObservedDeploymentStatus = observed.status ?? {};
  return {
    availableReplicas: status.availableReplicas ?? 0,
    conditions: rolloutConditions(status),
    deadlineAt,
    desiredReplicas: deployment.spec?.replicas ?? 1,
    generation: appliedGeneration,
    observedGeneration: appliedGeneration,
    replicas: status.replicas ?? 0,
    updatedReplicas: status.updatedReplicas ?? 0,
  };
}

function deploymentMatchesApply(
  observed: KubeObservedManifest | null,
  appliedUid: string,
  appliedGeneration: number,
): observed is KubeDeploymentManifest {
  return (
    observed?.kind === 'Deployment' &&
    observed.metadata?.uid === appliedUid &&
    observed.metadata.generation === appliedGeneration &&
    (observed.status as ObservedDeploymentStatus | undefined)?.observedGeneration === appliedGeneration
  );
}

function rolloutConditions(status: ObservedDeploymentStatus): KubeDeploymentCondition[] {
  return (status.conditions ?? []).map(
    (condition: ObservedDeploymentCondition): KubeDeploymentCondition => ({
      reason: condition.reason ?? '',
      status: deploymentConditionStatus(condition.status),
      type: condition.type ?? '',
    }),
  );
}
