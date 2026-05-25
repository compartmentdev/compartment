import { inspectDockerContainer, removeDockerContainer, type DockerInspectContainerResult } from '@compartment/docker';
import type { NodeDrainDeploymentRequest, NodeDrainDeploymentResponse } from '@compartment/contracts';
import type { NodeConfig } from '../config';
import { deploymentIdLabelName } from './runtime-container-labels';
import { reconcileRuntimeNetworksAfterContainerRemovalBestEffort } from './runtime-network-reconcile.service';

export async function drainRuntimeContainer(
  input: NodeDrainDeploymentRequest,
  config: NodeConfig,
): Promise<NodeDrainDeploymentResponse> {
  const acceptedAt: string = new Date().toISOString();

  await waitForDrainDeadline(input.drainDeadlineAt);
  if (await shouldDrainContainer(input)) {
    await removeDockerContainer({ containerRef: input.containerId });
  }
  await reconcileRuntimeNetworksAfterContainerRemovalBestEffort(config);

  return {
    acceptedAt,
  };
}

async function shouldDrainContainer(input: NodeDrainDeploymentRequest): Promise<boolean> {
  const container: DockerInspectContainerResult | null = await inspectDockerContainer({
    containerRef: input.containerId,
  });
  if (container === null) {
    return false;
  }
  if (container.labels[deploymentIdLabelName] === input.deploymentId) {
    return true;
  }

  throw new Error(`Container ${input.containerId} does not belong to deployment ${input.deploymentId}.`);
}

async function waitForDrainDeadline(drainDeadlineAt: string | undefined): Promise<void> {
  if (drainDeadlineAt === undefined) {
    return;
  }

  const delayMs: number = new Date(drainDeadlineAt).getTime() - Date.now();
  if (delayMs <= 0) {
    return;
  }

  await new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, delayMs);
  });
}
