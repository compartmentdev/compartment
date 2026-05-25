import { removeDockerContainer } from '@compartment/docker';
import type { NodeStopDeploymentRequest, NodeStopDeploymentResponse } from '@compartment/contracts';
import type { NodeConfig } from '../config';
import { reconcileRuntimeNetworksAfterContainerRemovalBestEffort } from './runtime-network-reconcile.service';

export async function stopRuntimeContainer(
  input: NodeStopDeploymentRequest,
  config: NodeConfig,
): Promise<NodeStopDeploymentResponse> {
  await removeDockerContainer({ containerRef: input.containerId });
  await reconcileRuntimeNetworksAfterContainerRemovalBestEffort(config);

  return {
    stoppedAt: new Date().toISOString(),
  };
}
