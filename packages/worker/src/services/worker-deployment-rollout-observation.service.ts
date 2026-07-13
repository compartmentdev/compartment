import type { DeploymentReconcileProjection, DeploymentReconcileTarget } from '@compartment/contracts';
import {
  calculateKubeRolloutStatus,
  type KubeDeploymentCondition,
  type KubeDeploymentManifest,
  type KubeObservation,
  type KubeObservedManifest,
  type KubeRolloutObservation,
} from '@compartment/kube-runtime';
import { deploymentConditionStatus, requiredDeploymentMetadata } from './worker-deployment-reconcile.helpers';
import type { ObservedDeploymentCondition, ObservedDeploymentStatus } from './worker-deployment-reconcile.types';

const defaultRolloutTimeoutMs: number = 50_000;
const observationSyncTimeoutMs: number = 1_000;

export function isObservedReady(
  observation: KubeObservation,
  deployment: KubeDeploymentManifest,
  deadlineAt: Date,
): boolean {
  const observed: KubeRolloutObservation | null = readDeploymentObservation(observation, deployment, deadlineAt);
  return observed !== null && calculateKubeRolloutStatus(observed, new Date()) === 'ready';
}

export async function readRolloutObservation(
  observation: KubeObservation,
  deployment: KubeDeploymentManifest,
  target: DeploymentReconcileTarget,
): Promise<KubeRolloutObservation | null> {
  const startedAt: number = new Date(target.rolloutStartedAt).getTime();
  const deadlineAt: Date = new Date(startedAt + rolloutTimeoutMs(target.candidate));
  const initial: KubeRolloutObservation | null = readDeploymentObservation(observation, deployment, deadlineAt);
  return initial ?? (await waitForDeploymentObservation(observation, deployment, deadlineAt));
}

export function rolloutTimeoutMs(projection: DeploymentReconcileProjection): number {
  return projection.readiness?.timeoutMs ?? defaultRolloutTimeoutMs;
}

async function waitForDeploymentObservation(
  observation: KubeObservation,
  deployment: KubeDeploymentManifest,
  deadlineAt: Date,
): Promise<KubeRolloutObservation | null> {
  return await new Promise<KubeRolloutObservation | null>(
    (resolve: (value: KubeRolloutObservation | null) => void): void => {
      const timer: NodeJS.Timeout = setTimeout((): void => {
        unsubscribe();
        resolve(null);
      }, observationSyncTimeoutMs);
      const unsubscribe: () => void = observation.onEvent((): void => {
        const observed: KubeRolloutObservation | null = readDeploymentObservation(observation, deployment, deadlineAt);
        if (observed !== null) {
          clearTimeout(timer);
          unsubscribe();
          resolve(observed);
        }
      });
    },
  );
}

function readDeploymentObservation(
  observation: KubeObservation,
  deployment: KubeDeploymentManifest,
  deadlineAt: Date,
): KubeRolloutObservation | null {
  const namespace: string = requiredDeploymentMetadata(deployment, 'namespace');
  const name: string = requiredDeploymentMetadata(deployment, 'name');
  const observed: KubeObservedManifest | undefined = observation.cache.get(`deployments/${namespace}/${name}`);
  if (observed?.kind !== 'Deployment') {
    return null;
  }
  const status: ObservedDeploymentStatus = observed.status ?? {};
  return {
    availableReplicas: status.availableReplicas ?? 0,
    conditions: rolloutConditions(status),
    deadlineAt,
    desiredReplicas: deployment.spec?.replicas ?? 1,
    generation: observed.metadata?.generation ?? 0,
    observedGeneration: status.observedGeneration ?? null,
  };
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
