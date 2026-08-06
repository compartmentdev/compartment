import type {
  DeploymentArtifactCleanupTarget,
  DeploymentReconcileTarget,
  WorkerObserveDeploymentReconcileResponse,
} from '@compartment/contracts';
import {
  calculateKubeRolloutStatus,
  type KubeDeploymentManifest,
  type KubeRolloutObservation,
  type KubeRolloutStatus,
  type KubeRuntime,
  type KubeWorkloadScheduling,
} from '@compartment/kube-runtime';
import type { CompartmentRequester } from '@compartment/sdk';
import type { TenantSecretsKeyring } from '../tenant-secret-environment.types';
import { applyApplication, recoverFailedRollout } from './worker-deployment-application.service';
import { persistDeploymentObservation, rolloutFailureMessage } from './worker-deployment-reconcile.helpers';
import { restartActiveCandidate } from './worker-deployment-restart.service';
import {
  infrastructureRolloutDeadlineAt,
  readCandidateRolloutObservation,
} from './worker-deployment-rollout-observation.service';
import type { DeploymentRolloutStartTracker } from './worker-deployment-rollout-start-tracker.service';

type PendingArguments = readonly [
  CompartmentRequester,
  KubeRuntime,
  DeploymentReconcileTarget,
  TenantSecretsKeyring,
  number,
];

export async function reconcilePendingDeployment(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  target: DeploymentReconcileTarget,
  tenantSecretsKek: TenantSecretsKeyring,
  infrastructureTimeoutMs: number,
  rolloutStarts: DeploymentRolloutStartTracker,
  scheduling: KubeWorkloadScheduling | undefined,
): Promise<DeploymentArtifactCleanupTarget[]> {
  const pendingArguments: PendingArguments = [request, runtime, target, tenantSecretsKek, infrastructureTimeoutMs];
  const rollout: KubeRolloutObservation | null = await readAppliedCandidateRollout(
    runtime,
    target,
    tenantSecretsKek,
    infrastructureTimeoutMs,
    rolloutStarts,
    scheduling,
  );
  return await resolvePendingRollout(rollout, pendingArguments, rolloutStarts, scheduling);
}

async function resolvePendingRollout(
  rollout: KubeRolloutObservation | null,
  pendingArguments: PendingArguments,
  rolloutStarts: DeploymentRolloutStartTracker,
  scheduling: KubeWorkloadScheduling | undefined,
): Promise<DeploymentArtifactCleanupTarget[]> {
  return rollout === null
    ? await handleMissingPendingDeployment(...pendingArguments, rolloutStarts, scheduling)
    : await handleRolloutStatus(
        ...pendingArguments,
        calculateKubeRolloutStatus(rollout, new Date()),
        rolloutStarts,
        scheduling,
      );
}

async function readAppliedCandidateRollout(
  runtime: KubeRuntime,
  target: DeploymentReconcileTarget,
  tenantSecretsKek: TenantSecretsKeyring,
  infrastructureTimeoutMs: number,
  rolloutStarts: DeploymentRolloutStartTracker,
  scheduling: KubeWorkloadScheduling | undefined,
): Promise<KubeRolloutObservation | null> {
  const candidate: KubeDeploymentManifest = await applyApplication(
    runtime,
    target,
    tenantSecretsKek,
    infrastructureTimeoutMs,
    scheduling,
  );
  return await readCandidateRolloutObservation(
    runtime,
    await runtime.read(candidate),
    candidate,
    target,
    infrastructureTimeoutMs,
    rolloutStarts,
  );
}

async function handleMissingPendingDeployment(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  target: DeploymentReconcileTarget,
  tenantSecretsKek: TenantSecretsKeyring,
  infrastructureTimeoutMs: number,
  rolloutStarts: DeploymentRolloutStartTracker,
  scheduling: KubeWorkloadScheduling | undefined,
): Promise<DeploymentArtifactCleanupTarget[]> {
  const restartArguments: PendingArguments = [request, runtime, target, tenantSecretsKek, infrastructureTimeoutMs];
  if (Date.now() < infrastructureRolloutDeadlineAt(target, infrastructureTimeoutMs).getTime()) {
    return [];
  }
  if (await restartActiveCandidate(...restartArguments, rolloutStarts, scheduling)) {
    return [];
  }
  await recoverFailedRollout(runtime, target, tenantSecretsKek, infrastructureTimeoutMs, scheduling);
  const applied: boolean = (
    await persistDeploymentObservation(request, target, 'failed', 'Kubernetes rollout timed out.')
  ).applied;
  clearCompletedFailedRollout(target, applied, rolloutStarts);
  return [];
}

async function handleRolloutStatus(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  target: DeploymentReconcileTarget,
  tenantSecretsKek: TenantSecretsKeyring,
  infrastructureTimeoutMs: number,
  status: KubeRolloutStatus,
  rolloutStarts: DeploymentRolloutStartTracker,
  scheduling: KubeWorkloadScheduling | undefined,
): Promise<DeploymentArtifactCleanupTarget[]> {
  const restartArguments: PendingArguments = [request, runtime, target, tenantSecretsKek, infrastructureTimeoutMs];
  if (status === 'ready') {
    return await persistReadyDeployment(request, target, rolloutStarts);
  }
  if (status === 'progressing' || (await restartActiveCandidate(...restartArguments, rolloutStarts, scheduling))) {
    return [];
  }
  await recoverFailedRollout(runtime, target, tenantSecretsKek, infrastructureTimeoutMs, scheduling);
  const applied: boolean = (
    await persistDeploymentObservation(request, target, 'failed', rolloutFailureMessage(status))
  ).applied;
  clearCompletedFailedRollout(target, applied, rolloutStarts);
  return [];
}

async function persistReadyDeployment(
  request: CompartmentRequester,
  target: DeploymentReconcileTarget,
  rolloutStarts: DeploymentRolloutStartTracker,
): Promise<DeploymentArtifactCleanupTarget[]> {
  const persisted: WorkerObserveDeploymentReconcileResponse = await persistDeploymentObservation(
    request,
    target,
    'ready',
  );
  rolloutStarts.clearIfApplied(target.candidate.deploymentId, persisted.applied);
  return persisted.cleanupArtifacts;
}

function clearCompletedFailedRollout(
  target: DeploymentReconcileTarget,
  applied: boolean,
  rolloutStarts: DeploymentRolloutStartTracker,
): void {
  if (target.active?.deploymentId !== target.candidate.deploymentId) {
    rolloutStarts.clearIfApplied(target.candidate.deploymentId, applied);
  }
}
