import type { DeploymentReconcileProjection, DeploymentReconcileTarget } from '@compartment/contracts';
import {
  type KubeDeploymentManifest,
  type KubeObservedManifest,
  type KubeRolloutObservation,
  readKubeRolloutObservation,
} from '@compartment/kube-runtime';

const defaultRolloutTimeoutMs: number = 50_000;

export function readRolloutObservation(
  observed: KubeObservedManifest | null,
  deployment: KubeDeploymentManifest,
  target: DeploymentReconcileTarget,
): KubeRolloutObservation | null {
  const startedAt: number = new Date(target.rolloutStartedAt).getTime();
  const deadlineAt: Date = new Date(startedAt + rolloutTimeoutMs(target.candidate));
  return readKubeRolloutObservation(observed, deployment, deadlineAt);
}

export function rolloutTimeoutMs(projection: DeploymentReconcileProjection): number {
  return projection.readiness?.timeoutMs ?? defaultRolloutTimeoutMs;
}
