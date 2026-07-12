import type {
  DeploymentReconcileTarget,
  ProductJobIntent,
  WorkerObserveDeploymentReconcileRequest,
} from '@compartment/contracts';
import {
  calculateKubeRolloutStatus,
  projectApplicationManifests,
  type KubeDeploymentManifest,
  type KubeDeploymentCondition,
  type KubeManifest,
  type KubeObservation,
  type KubeObservedManifest,
  type KubeRolloutObservation,
  type KubeRolloutStatus,
  type KubeRuntime,
} from '@compartment/kube-runtime';
import { observeDeploymentReconcile, type CompartmentRequester } from '@compartment/sdk';
import { executeProductJob } from './worker-product-job.service';
import type { ObservedDeploymentCondition, ObservedDeploymentStatus } from './worker-deployment-reconcile.types';
import {
  deploymentConditionStatus,
  deploymentFromObjects,
  deploymentManifest,
  releaseIntent,
  requiredDeploymentMetadata,
  rolloutFailureMessage,
} from './worker-deployment-reconcile.helpers';

const rolloutTimeoutMs: number = 50_000;
const releaseTimeoutMs: number = 600_000;

interface RolloutWaitHandles {
  timer?: NodeJS.Timeout;
  unsubscribe?: () => void;
}

export async function reconcileDeploymentTarget(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  target: DeploymentReconcileTarget,
): Promise<void> {
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

async function reconcileActiveDeployment(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  target: DeploymentReconcileTarget,
): Promise<void> {
  const deployment: KubeDeploymentManifest = deploymentManifest(target.candidate);
  await runtime.apply({ objects: projectApplicationManifests(target.candidate) });
  const observation: KubeObservation = await observeDeployment(runtime, deployment);
  try {
    await waitForReady(observation, deployment, rolloutTimeoutMs);
  } catch {
    await persistObservation(request, target, 'pending', 'Active Kubernetes Deployment drifted or became non-Ready.');
  } finally {
    await observation.stop();
  }
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
  const candidate: KubeDeploymentManifest = deploymentManifest(target.candidate);
  const observation: KubeObservation = await observeDeployment(runtime, candidate);
  try {
    const rollout: KubeRolloutObservation | null = readRolloutObservation(observation, candidate, target);
    if (rollout === null) {
      await handleMissingPendingDeployment(request, runtime, target);
      return;
    }
    const status: KubeRolloutStatus = calculateKubeRolloutStatus(rollout, new Date());
    await handleRolloutStatus(request, runtime, target, status);
  } finally {
    await observation.stop();
  }
}

async function handleMissingPendingDeployment(
  request: CompartmentRequester,
  runtime: KubeRuntime,
  target: DeploymentReconcileTarget,
): Promise<void> {
  const deadline: number = new Date(target.rolloutStartedAt).getTime() + rolloutTimeoutMs;
  if (Date.now() < deadline) {
    await runtime.apply({ objects: projectApplicationManifests(target.candidate) });
    return;
  }
  await recoverFailedRollout(runtime, target);
  await persistObservation(request, target, 'failed', 'Kubernetes rollout timed out.');
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
  await recoverFailedRollout(runtime, target);
  await persistObservation(request, target, 'failed', rolloutFailureMessage(status));
}

async function recoverFailedRollout(runtime: KubeRuntime, target: DeploymentReconcileTarget): Promise<void> {
  if (target.active === null) {
    return;
  }
  const activeObjects: KubeManifest[] = projectApplicationManifests(target.active);
  await runtime.apply({ force: true, objects: activeObjects });
  const activeDeployment: KubeDeploymentManifest = deploymentFromObjects(activeObjects);
  const observation: KubeObservation = await observeDeployment(runtime, activeDeployment);
  try {
    await waitForReady(observation, activeDeployment, rolloutTimeoutMs);
  } finally {
    await observation.stop();
  }
}

async function waitForReady(
  observation: KubeObservation,
  deployment: KubeDeploymentManifest,
  timeoutMs: number,
): Promise<void> {
  const deadlineAt: Date = new Date(Date.now() + timeoutMs);
  if (isObservedReady(observation, deployment, deadlineAt)) {
    return;
  }
  await new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => {
    const handles: RolloutWaitHandles = {};
    handles.timer = setTimeout((): void => {
      handles.unsubscribe?.();
      reject(new Error('Saved active Kubernetes Deployment did not recover before the rollout timeout.'));
    }, timeoutMs);
    handles.unsubscribe = observation.onEvent((): void => {
      if (isObservedReady(observation, deployment, deadlineAt)) {
        clearTimeout(handles.timer);
        handles.unsubscribe?.();
        resolve();
      }
    });
  });
}

function isObservedReady(observation: KubeObservation, deployment: KubeDeploymentManifest, deadlineAt: Date): boolean {
  const observed: KubeRolloutObservation | null = readDeploymentObservation(observation, deployment, deadlineAt);
  return observed !== null && calculateKubeRolloutStatus(observed, new Date()) === 'ready';
}

function readRolloutObservation(
  observation: KubeObservation,
  deployment: KubeDeploymentManifest,
  target: DeploymentReconcileTarget,
): KubeRolloutObservation | null {
  const startedAt: number = new Date(target.rolloutStartedAt).getTime();
  return readDeploymentObservation(observation, deployment, new Date(startedAt + rolloutTimeoutMs));
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
  const generation: number = observed.metadata?.generation ?? 0;
  return {
    availableReplicas: status.availableReplicas ?? 0,
    conditions: rolloutConditions(status),
    deadlineAt,
    desiredReplicas: deployment.spec?.replicas ?? 1,
    generation,
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

async function observeDeployment(runtime: KubeRuntime, deployment: KubeDeploymentManifest): Promise<KubeObservation> {
  const labels: Record<string, string> = deployment.spec?.selector.matchLabels ?? {};
  return await runtime.observe({
    labels,
    namespace: requiredDeploymentMetadata(deployment, 'namespace'),
    resources: ['deployments'],
  });
}

async function persistObservation(
  request: CompartmentRequester,
  target: DeploymentReconcileTarget,
  observation: 'pending' | 'ready' | 'failed',
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
