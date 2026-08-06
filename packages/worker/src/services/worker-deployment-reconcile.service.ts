import { setTimeout as delay } from 'node:timers/promises';
import type {
  DeploymentArtifactCleanupTarget,
  DeploymentReconcileTarget,
  ProductJobIntent,
  ProjectNetworkPolicyPorts,
  WorkerPersistProductJobIntentResponse,
  WorkerPersistProductJobResultRequest,
} from '@compartment/contracts';
import {
  calculateKubeRolloutStatus,
  projectApplicationManifests,
  type KubeDeploymentManifest,
  type KubeManifest,
  type KubeRolloutObservation,
  type KubeRolloutStatus,
  type KubeRuntime,
  type KubeWorkloadScheduling,
} from '@compartment/kube-runtime';
import { persistProductJobIntent, type CompartmentRequester } from '@compartment/sdk';
import {
  deploymentFromObjects,
  persistDeploymentObservation,
  releaseIntent,
  rolloutFailureMessage,
} from './worker-deployment-reconcile.helpers';
import {
  infrastructureRolloutDeadlineAt,
  readCandidateRolloutObservation,
  readRolloutObservation,
} from './worker-deployment-rollout-observation.service';
import {
  applyProjectNetworkPolicies,
  includeApplicationNetworkPolicyPorts,
  projectProjectNetworkPolicyManifests,
} from './worker-network-policy.service';
import { decryptTenantProjection } from '../tenant-workload-projections';
import type { TenantSecretsKeyring } from '../tenant-secret-environment.types';
import { restartActiveCandidate } from './worker-deployment-restart.service';
import type { WorkerArtifactRegistryConfig } from '../worker-artifact-registry.types';
import { retargetWorkerDeploymentArtifactImages } from '../worker-artifact-registry';

const releaseTimeoutMs: number = 600_000;
const activeReadinessCheckCount: number = 6;
const activeReadinessCheckIntervalMs: number = 2_000;

export async function reconcileDeploymentTarget(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  target: DeploymentReconcileTarget,
  artifactRegistry: WorkerArtifactRegistryConfig,
  tenantSecretsKek: TenantSecretsKeyring,
  scheduling?: KubeWorkloadScheduling,
): Promise<DeploymentArtifactCleanupTarget[]> {
  target = retargetWorkerDeploymentArtifactImages(target, artifactRegistry);
  if (await reconcileStopState(request, runtime, target, tenantSecretsKek, scheduling)) {
    return [];
  }
  if (target.state === 'desired') {
    await reconcileDesiredDeployment(request, runtime, target, tenantSecretsKek, scheduling);
    return [];
  }
  if (target.state === 'pending') {
    return await reconcilePendingDeployment(request, runtime, target, tenantSecretsKek, scheduling);
  }
  await reconcileActiveDeployment(request, runtime, target, tenantSecretsKek, scheduling);
  return [];
}

async function reconcileStopState(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  target: DeploymentReconcileTarget,
  tenantSecretsKek: TenantSecretsKeyring,
  scheduling: KubeWorkloadScheduling | undefined,
): Promise<boolean> {
  if (target.state !== 'stopping') {
    return target.state === 'stopped';
  }
  await runtime.delete(
    projectApplicationManifests(decryptTenantProjection(target.candidate, scheduling, tenantSecretsKek)),
  );
  await applyProjectNetworkPolicies(runtime, target.candidate.projectId, target.networkPolicy);
  await persistDeploymentObservation(request, target, 'stopped');
  return true;
}

async function reconcileActiveDeployment(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  target: DeploymentReconcileTarget,
  tenantSecretsKek: TenantSecretsKeyring,
  scheduling: KubeWorkloadScheduling | undefined,
): Promise<void> {
  const applied: KubeDeploymentManifest = await applyApplication(runtime, target, tenantSecretsKek, scheduling);
  if (await activeDeploymentRemainsNonReady(runtime, applied, target)) {
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
): Promise<boolean> {
  for (let check: number = 0; check < activeReadinessCheckCount; check += 1) {
    const rollout: KubeRolloutObservation | null = readRolloutObservation(
      await runtime.read(applied),
      applied,
      target,
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
  scheduling: KubeWorkloadScheduling | undefined,
): Promise<void> {
  const release: ProductJobIntent | null = releaseIntent(target.candidate, releaseTimeoutMs);
  if (release !== null) {
    await applyProjectNetworkPolicies(runtime, target.candidate.projectId, deploymentNetworkPolicy(target));
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
  await applyApplication(runtime, target, tenantSecretsKek, scheduling);
  await persistDeploymentObservation(request, target, 'pending');
}

async function reconcilePendingDeployment(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  target: DeploymentReconcileTarget,
  tenantSecretsKek: TenantSecretsKeyring,
  scheduling: KubeWorkloadScheduling | undefined,
): Promise<DeploymentArtifactCleanupTarget[]> {
  const candidate: KubeDeploymentManifest = await applyApplication(runtime, target, tenantSecretsKek, scheduling);
  const rollout: KubeRolloutObservation | null = await readCandidateRolloutObservation(
    runtime,
    await runtime.read(candidate),
    candidate,
    target,
  );
  if (rollout === null) {
    return await handleMissingPendingDeployment(request, runtime, target, tenantSecretsKek, scheduling);
  }
  const status: KubeRolloutStatus = calculateKubeRolloutStatus(rollout, new Date());
  return await handleRolloutStatus(request, runtime, target, status, tenantSecretsKek, scheduling);
}

async function handleMissingPendingDeployment(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  target: DeploymentReconcileTarget,
  tenantSecretsKek: TenantSecretsKeyring,
  scheduling: KubeWorkloadScheduling | undefined,
): Promise<DeploymentArtifactCleanupTarget[]> {
  if (Date.now() < infrastructureRolloutDeadlineAt(target).getTime()) {
    return [];
  }
  if (await restartActiveCandidate(request, runtime, target, tenantSecretsKek, scheduling)) {
    return [];
  }
  await recoverFailedRollout(runtime, target, tenantSecretsKek, scheduling);
  await persistDeploymentObservation(request, target, 'failed', 'Kubernetes rollout timed out.');
  return [];
}

async function applyApplication(
  runtime: KubeRuntime,
  target: DeploymentReconcileTarget,
  tenantSecretsKek: TenantSecretsKeyring,
  scheduling: KubeWorkloadScheduling | undefined,
): Promise<KubeDeploymentManifest> {
  return deploymentFromObjects(
    await runtime.apply({
      objects: [
        ...projectProjectNetworkPolicyManifests(target.candidate.projectId, deploymentNetworkPolicy(target)),
        ...projectApplicationManifests(decryptTenantProjection(target.candidate, scheduling, tenantSecretsKek)),
      ],
    }),
  );
}

async function handleRolloutStatus(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  target: DeploymentReconcileTarget,
  status: KubeRolloutStatus,
  tenantSecretsKek: TenantSecretsKeyring,
  scheduling: KubeWorkloadScheduling | undefined,
): Promise<DeploymentArtifactCleanupTarget[]> {
  if (status === 'ready') {
    return await persistDeploymentObservation(request, target, 'ready');
  }
  if (status === 'progressing') {
    return [];
  }
  if (await restartActiveCandidate(request, runtime, target, tenantSecretsKek, scheduling)) {
    return [];
  }
  await recoverFailedRollout(runtime, target, tenantSecretsKek, scheduling);
  await persistDeploymentObservation(request, target, 'failed', rolloutFailureMessage(status));
  return [];
}

async function recoverFailedRollout(
  runtime: KubeRuntime,
  target: DeploymentReconcileTarget,
  tenantSecretsKek: TenantSecretsKeyring,
  scheduling: KubeWorkloadScheduling | undefined,
): Promise<void> {
  if (target.active === null) {
    return;
  }
  const activeObjects: KubeManifest[] = projectApplicationManifests(
    decryptTenantProjection(target.active, scheduling, tenantSecretsKek),
  );
  await runtime.apply({
    force: true,
    objects: [
      ...projectProjectNetworkPolicyManifests(target.candidate.projectId, deploymentNetworkPolicy(target)),
      ...activeObjects,
    ],
  });
}

function deploymentNetworkPolicy(target: DeploymentReconcileTarget): ProjectNetworkPolicyPorts {
  return includeApplicationNetworkPolicyPorts(target.networkPolicy, target.candidate.containerPorts);
}
