import { updateDockerContainerRestartPolicy, type DockerUpdateContainerRestartPolicyInput } from '@compartment/docker';
import type { NodeResourceResponse, NodeResourceRestartPolicyRequest } from '@compartment/contracts';
import type { RuntimeDeployConfig } from './runtime.types';
import { buildResourceNetworkAlias } from './runtime-names.service';

export async function updateRuntimeResourceRestartPolicy(
  input: NodeResourceRestartPolicyRequest,
  config: RuntimeDeployConfig,
): Promise<NodeResourceResponse> {
  await updateDockerContainerRestartPolicy(buildDockerRestartPolicyUpdateInput(input));

  return {
    containerId: input.containerId,
    hostname: buildResourceNetworkAlias(input, config.dockerNamespace),
    status: 'running',
  };
}

function buildDockerRestartPolicyUpdateInput(
  input: NodeResourceRestartPolicyRequest,
): DockerUpdateContainerRestartPolicyInput {
  return {
    containerRef: input.containerId,
    restartPolicy: {
      name: input.restart.policy,
    },
  };
}
