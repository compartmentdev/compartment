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
  type KubeObservation,
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
  requiredDeploymentMetadata,
  rolloutFailureMessage,
} from './worker-deployment-reconcile.helpers';
import {
  isObservedReady,
  readRolloutObservation,
  rolloutTimeoutMs,
} from './worker-deployment-rollout-observation.service';

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
  const deployment: KubeDeploymentManifest = deploymentManifest(target.candidate);
  await runtime.apply({ objects: projectApplicationManifests(target.candidate) });
  const rollout: KubeRolloutObservation | null = readRolloutObservation(
    await runtime.read(deployment),
    deployment,
    target,
  );
  if (rollout === null || calculateKubeRolloutStatus(rollout, new Date()) !== 'ready') {
    await persistObservation(request, target, 'pending', 'Active Kubernetes Deployment drifted or became non-Ready.');
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
    await waitForReady(observation, activeDeployment, rolloutTimeoutMs(target.active));
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
  await waitForObservedReady(observation, deployment, deadlineAt, timeoutMs);
}

async function waitForObservedReady(
  observation: KubeObservation,
  deployment: KubeDeploymentManifest,
  deadlineAt: Date,
  timeoutMs: number,
): Promise<void> {
  await new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => {
    const handles: RolloutWaitHandles = {};
    const resolveWhenReady: () => void = (): void => {
      if (!isObservedReady(observation, deployment, deadlineAt)) {
        return;
      }
      clearTimeout(handles.timer);
      handles.unsubscribe?.();
      resolve();
    };
    handles.timer = setTimeout((): void => {
      handles.unsubscribe?.();
      reject(new Error('Saved active Kubernetes Deployment did not recover before the rollout timeout.'));
    }, timeoutMs);
    handles.unsubscribe = observation.onEvent(resolveWhenReady);
    resolveWhenReady();
  });
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
