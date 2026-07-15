import { createProjectLifecycleRuntimeStopFailedError } from '../errors/api-business-error';
import { findDeploymentKubeState, requestDeploymentKubeStop } from '../queries/deployment-kube-membership.query';
import type { DeploymentKubeState } from '../queries/deployment-kube-state.types';

const stopTimeoutMs: number = 30_000;
const stopPollIntervalMs: number = 100;

export async function stopKubeProjectDeployment(
  deploymentId: string,
  state: DeploymentKubeState,
  updatedAt: Date,
): Promise<void> {
  if (state === 'active' || state === 'desired' || state === 'pending') {
    await requestDeploymentKubeStop(deploymentId, updatedAt);
  }
  await waitUntilStopped(deploymentId);
}

async function waitUntilStopped(deploymentId: string): Promise<void> {
  const deadline: number = Date.now() + stopTimeoutMs;
  while (Date.now() < deadline) {
    if ((await findDeploymentKubeState(deploymentId)) === 'stopped') {
      return;
    }
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, stopPollIntervalMs);
    });
  }
  throw createProjectLifecycleRuntimeStopFailedError();
}
