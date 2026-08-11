import { setTimeout as delay } from 'node:timers/promises';
import type {
  DeploymentArtifactCleanupTarget,
  DeploymentReconcileTarget,
  ProductJobIntent,
  WorkerPersistProductJobIntentResponse,
  WorkerPersistProductJobResultRequest,
} from '@compartment/contracts';
import {
  calculateKubeRolloutStatus,
  type KubeDeploymentManifest,
  type KubeRolloutObservation,
  type KubeRuntime,
  type KubeWorkloadScheduling,
} from '@compartment/kube-runtime';
import { persistProductJobIntent, type CompartmentRequester } from '@compartment/sdk';
import { persistDeploymentObservation, releaseIntent } from './worker-deployment-reconcile.helpers';
import { readRolloutObservation } from './worker-deployment-rollout-observation.service';
import { applyProjectNetworkPolicies } from './worker-network-policy.service';
import type { TenantSecretsKeyring } from '../tenant-secret-environment.types';
import type { WorkerArtifactRegistryConfig } from '../worker-artifact-registry.types';
import { retargetWorkerDeploymentArtifactImages } from '../worker-artifact-registry';
import type { DeploymentRolloutStartTracker } from './worker-deployment-rollout-start-tracker.service';
import { applyApplication, deleteApplication } from './worker-deployment-application.service';
import { reconcilePendingDeployment } from './worker-deployment-pending.service';
import { readDeploymentQuotaAdmissionFailure } from './worker-deployment-quota-failure.service';

const releaseTimeoutMs: number = 600_000;
const activeReadinessCheckCount: number = 6;
const activeReadinessCheckIntervalMs: number = 2_000;
type ReconcileArguments = readonly [
  CompartmentRequester,
  KubeRuntime,
  DeploymentReconcileTarget,
  TenantSecretsKeyring,
  number,
  string,
];

export async function reconcileDeploymentTarget(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  target: DeploymentReconcileTarget,
  artifactRegistry: WorkerArtifactRegistryConfig,
  tenantSecretsKek: TenantSecretsKeyring,
  infrastructureTimeoutMs: number,
  workerImage: string,
  rolloutStarts: DeploymentRolloutStartTracker,
  scheduling?: KubeWorkloadScheduling,
): Promise<DeploymentArtifactCleanupTarget[]> {
  target = retargetWorkerDeploymentArtifactImages(target, artifactRegistry);
  try {
    return await reconcileDeploymentTargetUnchecked(
      request,
      runtime,
      target,
      tenantSecretsKek,
      infrastructureTimeoutMs,
      workerImage,
      rolloutStarts,
      scheduling,
    );
  } catch (error) {
    const message: string | null =
      (target.state === 'desired' || target.state === 'pending') && error instanceof Error
        ? readDeploymentQuotaAdmissionFailure(error)
        : null;
    if (message === null) {
      throw error;
    }
    return (await persistDeploymentObservation(request, target, 'failed', message)).cleanupArtifacts;
  }
}

async function reconcileDeploymentTargetUnchecked(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  target: DeploymentReconcileTarget,
  tenantSecretsKek: TenantSecretsKeyring,
  infrastructureTimeoutMs: number,
  workerImage: string,
  rolloutStarts: DeploymentRolloutStartTracker,
  scheduling: KubeWorkloadScheduling | undefined,
): Promise<DeploymentArtifactCleanupTarget[]> {
  const reconcileArguments: ReconcileArguments = [
    request,
    runtime,
    target,
    tenantSecretsKek,
    infrastructureTimeoutMs,
    workerImage,
  ];
  if (target.state === 'pending') {
    return await reconcilePendingDeployment(...reconcileArguments, rolloutStarts, scheduling);
  }
  if (await reconcileStopState(...reconcileArguments, rolloutStarts, scheduling)) {
    return [];
  }
  rolloutStarts.clear(target.candidate.deploymentId);
  await reconcileNonPendingDeployment(...reconcileArguments, scheduling);
  return [];
}

async function reconcileNonPendingDeployment(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  target: DeploymentReconcileTarget,
  tenantSecretsKek: TenantSecretsKeyring,
  infrastructureTimeoutMs: number,
  workerImage: string,
  scheduling: KubeWorkloadScheduling | undefined,
): Promise<void> {
  const deploymentArguments: ReconcileArguments = [
    request,
    runtime,
    target,
    tenantSecretsKek,
    infrastructureTimeoutMs,
    workerImage,
  ];
  if (target.state === 'desired') {
    await reconcileDesiredDeployment(...deploymentArguments, scheduling);
    return;
  }
  await reconcileActiveDeployment(...deploymentArguments, scheduling);
}

async function reconcileStopState(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  target: DeploymentReconcileTarget,
  tenantSecretsKek: TenantSecretsKeyring,
  infrastructureTimeoutMs: number,
  workerImage: string,
  rolloutStarts: DeploymentRolloutStartTracker,
  scheduling: KubeWorkloadScheduling | undefined,
): Promise<boolean> {
  if (target.state === 'stopped') {
    rolloutStarts.clear(target.candidate.deploymentId);
    return true;
  }
  if (target.state !== 'stopping') {
    return false;
  }
  await deleteApplication(runtime, target, tenantSecretsKek, infrastructureTimeoutMs, scheduling, workerImage);
  await applyProjectNetworkPolicies(runtime, target.candidate.projectId, target.networkPolicy);
  const applied: boolean = (await persistDeploymentObservation(request, target, 'stopped')).applied;
  rolloutStarts.clearIfApplied(target.candidate.deploymentId, applied);
  return true;
}

async function reconcileActiveDeployment(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  target: DeploymentReconcileTarget,
  tenantSecretsKek: TenantSecretsKeyring,
  infrastructureTimeoutMs: number,
  workerImage: string,
  scheduling: KubeWorkloadScheduling | undefined,
): Promise<void> {
  const applied: KubeDeploymentManifest = await applyApplication(
    runtime,
    target,
    tenantSecretsKek,
    infrastructureTimeoutMs,
    scheduling,
    workerImage,
  );
  if (await activeDeploymentRemainsNonReady(runtime, applied, target, infrastructureTimeoutMs)) {
    await persistDeploymentObservation(
      request,
      target,
      'pending',
      'Active Kubernetes Deployment drifted or became non-Ready.',
    );
  }
}

async function activeDeploymentRemainsNonReady(
  runtime: KubeRuntime,
  applied: KubeDeploymentManifest,
  target: DeploymentReconcileTarget,
  infrastructureTimeoutMs: number,
): Promise<boolean> {
  for (let check: number = 0; check < activeReadinessCheckCount; check += 1) {
    const rollout: KubeRolloutObservation | null = readRolloutObservation(
      await runtime.read(applied),
      applied,
      target,
      infrastructureTimeoutMs,
      null,
    );
    if (rollout !== null && calculateKubeRolloutStatus(rollout, new Date()) === 'ready') {
      return false;
    }
    if (check + 1 < activeReadinessCheckCount) {
      await delay(activeReadinessCheckIntervalMs);
    }
  }
  return true;
}

async function reconcileDesiredDeployment(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  target: DeploymentReconcileTarget,
  tenantSecretsKek: TenantSecretsKeyring,
  infrastructureTimeoutMs: number,
  workerImage: string,
  scheduling: KubeWorkloadScheduling | undefined,
): Promise<void> {
  const release: ProductJobIntent | null = releaseIntent(target.candidate, releaseTimeoutMs);
  if (release !== null) {
    await applyProjectNetworkPolicies(runtime, target.candidate.projectId, target.networkPolicy);
    const persisted: WorkerPersistProductJobIntentResponse = await persistProductJobIntent(request, release);
    if (persisted.result === null) {
      return;
    }
    const result: WorkerPersistProductJobResultRequest = persisted.result;
    if (result.status !== 'succeeded') {
      await persistDeploymentObservation(request, target, 'failed', `Release Job ${result.status}: ${result.logs}`);
      return;
    }
  }
  await applyApplication(runtime, target, tenantSecretsKek, infrastructureTimeoutMs, scheduling, workerImage);
  await persistDeploymentObservation(request, target, 'pending');
}
