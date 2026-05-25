import { removeDockerContainer, removeDockerVolume } from '@compartment/docker';
import type { NodeResourceDeleteRequest, NodeResourceResponse, NodeResourceStopRequest } from '@compartment/contracts';
import { buildResourceNetworkAlias, buildResourceVolumeName } from './runtime-names.service';
import { reconcileRuntimeNetworks } from './runtime-network.service';
import type { RuntimeDeployConfig } from './runtime.types';

export async function deleteRuntimeResource(
  input: NodeResourceDeleteRequest,
  config: RuntimeDeployConfig,
): Promise<NodeResourceResponse> {
  const response: NodeResourceResponse =
    input.containerId === null
      ? buildStoppedResourceResponse(input, config)
      : await stopRuntimeResource({ ...input, containerId: input.containerId }, config);
  if (input.deleteData === true) {
    for (const volume of input.volumes) {
      await removeDockerVolume({
        volumeName: buildResourceVolumeName(input, config.dockerNamespace, volume.name),
      });
    }
  }
  if (input.containerId === null) {
    await reconcileRuntimeNetworks(config, { disconnectCaddyStaleNetworks: true });
  }

  return response;
}

export async function stopRuntimeResource(
  input: NodeResourceStopRequest,
  config: RuntimeDeployConfig,
): Promise<NodeResourceResponse> {
  await removeDockerContainer({ containerRef: input.containerId });
  await reconcileRuntimeNetworks(config, { disconnectCaddyStaleNetworks: true });

  return buildStoppedResourceResponse(input, config);
}

function buildStoppedResourceResponse(
  input: NodeResourceDeleteRequest | NodeResourceStopRequest,
  config: RuntimeDeployConfig,
): NodeResourceResponse {
  return {
    containerId: null,
    hostname: buildResourceNetworkAlias(input, config.dockerNamespace),
    status: 'stopped',
  };
}
