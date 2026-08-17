import type {
  DeploymentArtifactCleanupTarget,
  DeploymentReconcileTarget,
  WorkerObserveDeploymentReconcileResponse,
} from '@compartment/contracts';
import {
  calculateKubeRolloutStatus,
  type KubeRolloutObservation,
  type KubeRolloutStatus,
  type KubeRuntime,
  type KubeWorkloadScheduling,
} from '@compartment/kube-runtime';
import type { CompartmentRequester } from '@compartment/sdk';
import type { TenantSecretsKeyring } from '../tenant-secret-environment.types';
import {
  applyPendingApplication,
  cleanupFailedRollout,
  recoverFailedRollout,
  type AppliedPendingApplication,
} from './worker-deployment-application.service';
import { persistDeploymentObservation, rolloutFailureMessage } from './worker-deployment-reconcile.helpers';
import { restartActiveCandidate } from './worker-deployment-restart.service';
import {
  infrastructureRolloutDeadlineAt,
  maximumRolloutDeadlineAt,
  readCandidateRolloutObservation,
} from './worker-deployment-rollout-observation.service';
import type { DeploymentRolloutStartTracker } from './worker-deployment-rollout-start-tracker.service';
import { readDeploymentQuotaRolloutFailure } from './worker-deployment-quota-failure.service';

type PendingArguments = readonly [
  CompartmentRequester,
  KubeRuntime,
  DeploymentReconcileTarget,
  TenantSecretsKeyring,
  number,
  string,
];
type PendingFailureEffect = 'cleanup-candidate' | 'recover-active';

export async function reconcilePendingDeployment(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  target: DeploymentReconcileTarget,
  tenantSecretsKek: TenantSecretsKeyring,
  infrastructureTimeoutMs: number,
  workerImage: string,
  rolloutStarts: DeploymentRolloutStartTracker,
  scheduling: KubeWorkloadScheduling | undefined,
): Promise<DeploymentArtifactCleanupTarget[]> {
  const pendingArguments: PendingArguments = [
    request,
    runtime,
    target,
    tenantSecretsKek,
    infrastructureTimeoutMs,
    workerImage,
  ];
  const rollout: KubeRolloutObservation | null = await readAppliedCandidateRollout(
    runtime,
    target,
    tenantSecretsKek,
    infrastructureTimeoutMs,
    workerImage,
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
  if (rollout === null) {
    return await handleMissingPendingDeployment(...pendingArguments, rolloutStarts, scheduling);
  }
  const quotaFailure: string | null = readDeploymentQuotaRolloutFailure(rollout);
  return quotaFailure === null
    ? await handleRolloutStatus(
        ...pendingArguments,
        calculateKubeRolloutStatus(rollout, new Date()),
        rolloutStarts,
        scheduling,
      )
    : await failPendingDeployment(...pendingArguments, quotaFailure, rolloutStarts, scheduling, 'recover-active');
}

async function readAppliedCandidateRollout(
  runtime: KubeRuntime,
  target: DeploymentReconcileTarget,
  tenantSecretsKek: TenantSecretsKeyring,
  infrastructureTimeoutMs: number,
  workerImage: string,
  rolloutStarts: DeploymentRolloutStartTracker,
  scheduling: KubeWorkloadScheduling | undefined,
): Promise<KubeRolloutObservation | null> {
  const applied: AppliedPendingApplication = await applyPendingApplication(
    runtime,
    target,
    tenantSecretsKek,
    infrastructureTimeoutMs,
    scheduling,
    workerImage,
  );
  hydrateRecoveryRestarted(applied, target, infrastructureTimeoutMs, rolloutStarts);
  return await readCandidateRolloutObservation(
    runtime,
    await runtime.read(applied.deployment),
    applied.deployment,
    target,
    infrastructureTimeoutMs,
    rolloutStarts,
  );
}

function hydrateRecoveryRestarted(
  applied: AppliedPendingApplication,
  target: DeploymentReconcileTarget,
  infrastructureTimeoutMs: number,
  rolloutStarts: DeploymentRolloutStartTracker,
): void {
  if (applied.recoveryRestarted) {
    rolloutStarts.hydrateRecoveryRestarted(
      target.candidate.deploymentId,
      maximumRolloutDeadlineAt(target, infrastructureTimeoutMs),
    );
  }
}

async function handleMissingPendingDeployment(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  target: DeploymentReconcileTarget,
  tenantSecretsKek: TenantSecretsKeyring,
  infrastructureTimeoutMs: number,
  workerImage: string,
  rolloutStarts: DeploymentRolloutStartTracker,
  scheduling: KubeWorkloadScheduling | undefined,
): Promise<DeploymentArtifactCleanupTarget[]> {
  const restartArguments: PendingArguments = [
    request,
    runtime,
    target,
    tenantSecretsKek,
    infrastructureTimeoutMs,
    workerImage,
  ];
  if (Date.now() < infrastructureRolloutDeadlineAt(target, infrastructureTimeoutMs).getTime()) {
    return [];
  }
  if (await restartActiveCandidate(...restartArguments, rolloutStarts, scheduling)) {
    return [];
  }
  await cleanupFailedRollout(runtime, target, tenantSecretsKek, infrastructureTimeoutMs, scheduling, workerImage);
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
  workerImage: string,
  status: KubeRolloutStatus,
  rolloutStarts: DeploymentRolloutStartTracker,
  scheduling: KubeWorkloadScheduling | undefined,
): Promise<DeploymentArtifactCleanupTarget[]> {
  const restartArguments: PendingArguments = [
    request,
    runtime,
    target,
    tenantSecretsKek,
    infrastructureTimeoutMs,
    workerImage,
  ];
  if (status === 'ready') {
    return await persistReadyDeployment(request, target, rolloutStarts);
  }
  if (status === 'progressing' || (await restartActiveCandidate(...restartArguments, rolloutStarts, scheduling))) {
    return [];
  }
  return await failPendingDeployment(
    request,
    runtime,
    target,
    tenantSecretsKek,
    infrastructureTimeoutMs,
    workerImage,
    rolloutFailureMessage(status),
    rolloutStarts,
    scheduling,
    'cleanup-candidate',
  );
}

async function failPendingDeployment(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  target: DeploymentReconcileTarget,
  tenantSecretsKek: TenantSecretsKeyring,
  infrastructureTimeoutMs: number,
  workerImage: string,
  message: string,
  rolloutStarts: DeploymentRolloutStartTracker,
  scheduling: KubeWorkloadScheduling | undefined,
  effect: PendingFailureEffect,
): Promise<DeploymentArtifactCleanupTarget[]> {
  if (effect === 'cleanup-candidate') {
    await cleanupFailedRollout(runtime, target, tenantSecretsKek, infrastructureTimeoutMs, scheduling, workerImage);
  } else {
    await recoverFailedRollout(runtime, target, tenantSecretsKek, infrastructureTimeoutMs, scheduling, workerImage);
  }
  const persisted: WorkerObserveDeploymentReconcileResponse = await persistDeploymentObservation(
    request,
    target,
    'failed',
    message,
  );
  clearCompletedFailedRollout(target, persisted.applied, rolloutStarts);
  return persisted.cleanupArtifacts;
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
