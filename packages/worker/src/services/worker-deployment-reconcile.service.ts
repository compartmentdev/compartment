import { setTimeout as delay } from 'node:timers/promises';
import type {
  DeploymentReconcileTarget,
  ProductJobIntent,
  WorkerObserveDeploymentReconcileRequest,
} from '@compartment/contracts';
import {
  calculateKubeRolloutStatus,
  projectApplicationManifests,
  type KubeDeploymentManifest,
  type KubeManifest,
  type KubeRolloutObservation,
  type KubeRolloutStatus,
  type KubeRuntime,
} from '@compartment/kube-runtime';
import { observeDeploymentReconcile, type CompartmentRequester } from '@compartment/sdk';
import { executeProductJob } from './worker-product-job.service';
import {
  deploymentFromObjects,
  deploymentManifest,
  releaseIntent,
  rolloutFailureMessage,
} from './worker-deployment-reconcile.helpers';
import { readRolloutObservation, rolloutTimeoutMs } from './worker-deployment-rollout-observation.service';

const releaseTimeoutMs: number = 600_000;
const activeReadinessCheckCount: number = 6;
const activeReadinessCheckIntervalMs: number = 2_000;

export async function reconcileDeploymentTarget(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  target: DeploymentReconcileTarget,
): Promise<void> {
  if (await reconcileStopState(request, runtime, target)) {
    return;
  }
  if (target.state === 'desired') {
    await reconcileDesiredDeployment(request, runtime, target);
    return;
  }
  if (target.state === 'pending') {
    await reconcilePendingDeployment(request, runtime, target);
    return;
  }
  await reconcileActiveDeployment(request, runtime, target);
}

async function reconcileStopState(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  target: DeploymentReconcileTarget,
): Promise<boolean> {
  if (target.state !== 'stopping') {
    return target.state === 'stopped';
  }
  await runtime.delete(projectApplicationManifests(target.candidate));
  await persistObservation(request, target, 'stopped');
  return true;
}

async function reconcileActiveDeployment(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  target: DeploymentReconcileTarget,
): Promise<void> {
  const applied: KubeDeploymentManifest = await applyApplication(runtime, target);
  if (await activeDeploymentRemainsNonReady(runtime, applied, target)) {
    await persistObservation(request, target, 'pending', 'Active Kubernetes Deployment drifted or became non-Ready.');
  }
}

async function activeDeploymentRemainsNonReady(
  runtime: KubeRuntime,
  applied: KubeDeploymentManifest,
  target: DeploymentReconcileTarget,
): Promise<boolean> {
  for (let check: number = 0; check < activeReadinessCheckCount; check += 1) {
    const rollout: KubeRolloutObservation | null = readRolloutObservation(await runtime.read(applied), applied, target);
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
): Promise<void> {
  const release: ProductJobIntent | null = releaseIntent(target.candidate, releaseTimeoutMs);
  if (release !== null) {
    try {
      await executeProductJob(request, runtime, release);
    } catch (error) {
      const message: string = error instanceof Error ? error.message : 'Release Job failed.';
      await persistObservation(request, target, 'failed', message);
      return;
    }
  }
  await runtime.apply({ objects: projectApplicationManifests(target.candidate) });
  await persistObservation(request, target, 'pending');
}

async function reconcilePendingDeployment(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  target: DeploymentReconcileTarget,
): Promise<void> {
  const candidate: KubeDeploymentManifest = await applyApplication(runtime, target);
  const rollout: KubeRolloutObservation | null = readRolloutObservation(
    await runtime.read(candidate),
    candidate,
    target,
  );
  if (rollout === null) {
    await handleMissingPendingDeployment(request, runtime, target);
    return;
  }
  const status: KubeRolloutStatus = calculateKubeRolloutStatus(rollout, new Date());
  await handleRolloutStatus(request, runtime, target, status);
}

async function handleMissingPendingDeployment(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  target: DeploymentReconcileTarget,
): Promise<void> {
  const deadline: number = new Date(target.rolloutStartedAt).getTime() + rolloutTimeoutMs(target.candidate);
  if (Date.now() < deadline) {
    return;
  }
  if (await restartActiveCandidate(request, runtime, target)) {
    return;
  }
  await recoverFailedRollout(runtime, target);
  await persistObservation(request, target, 'failed', 'Kubernetes rollout timed out.');
}

async function applyApplication(
  runtime: KubeRuntime,
  target: DeploymentReconcileTarget,
): Promise<KubeDeploymentManifest> {
  return deploymentFromObjects(await runtime.apply({ objects: projectApplicationManifests(target.candidate) }));
}

async function handleRolloutStatus(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  target: DeploymentReconcileTarget,
  status: KubeRolloutStatus,
): Promise<void> {
  if (status === 'ready') {
    await persistObservation(request, target, 'ready');
    return;
  }
  if (status === 'progressing') {
    return;
  }
  if (await restartActiveCandidate(request, runtime, target)) {
    return;
  }
  await recoverFailedRollout(runtime, target);
  await persistObservation(request, target, 'failed', rolloutFailureMessage(status));
}

async function restartActiveCandidate(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  target: DeploymentReconcileTarget,
): Promise<boolean> {
  if (target.active?.deploymentId !== target.candidate.deploymentId) {
    return false;
  }
  await runtime.delete([deploymentManifest(target.candidate)]);
  await runtime.apply({ force: true, objects: projectApplicationManifests(target.candidate) });
  await persistObservation(request, target, 'pending', 'Restarting an unhealthy active Kubernetes Deployment.');
  return true;
}

async function recoverFailedRollout(runtime: KubeRuntime, target: DeploymentReconcileTarget): Promise<void> {
  if (target.active === null) {
    return;
  }
  const activeObjects: KubeManifest[] = projectApplicationManifests(target.active);
  await runtime.apply({ force: true, objects: activeObjects });
}

async function persistObservation(
  request: CompartmentRequester,
  target: DeploymentReconcileTarget,
  observation: 'pending' | 'ready' | 'failed' | 'stopped',
  message?: string,
): Promise<void> {
  const input: WorkerObserveDeploymentReconcileRequest = {
    deploymentId: target.candidate.deploymentId,
    ...(message === undefined ? {} : { message }),
    observation,
    observedAt: new Date().toISOString(),
    revision: target.revision,
  };
  await observeDeploymentReconcile(request, input);
}
