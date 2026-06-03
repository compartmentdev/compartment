import {
  inspectDockerNetwork,
  type DockerInspectContainerResult,
  type DockerInspectNetworkResult,
} from '@compartment/docker';
import { hasText } from '@compartment/utils';
import { environmentIdLabelName, projectIdLabelName, serviceIdLabelName } from './runtime-container-labels';
import type { RuntimeNetworkCapacityConfig } from './runtime-network-capacity.types';
import { assertCompatibleExistingRuntimeNetwork } from './runtime-network-managed.service';

export async function assertInspectableRuntimeNetwork(
  networkName: string,
  container: DockerInspectContainerResult,
  config: RuntimeNetworkCapacityConfig,
): Promise<void> {
  const network: DockerInspectNetworkResult | null = await inspectDockerNetwork({ networkName });
  if (network === null) {
    throw new Error(`Docker runtime network ${networkName} is missing.`);
  }

  assertCompatibleExistingRuntimeNetwork(
    {
      environmentId: readRequiredRuntimeContainerLabel(container, environmentIdLabelName),
      kind: 'service',
      networkName,
      projectId: readRequiredRuntimeContainerLabel(container, projectIdLabelName),
      serviceId: readRequiredRuntimeContainerLabel(container, serviceIdLabelName),
    },
    network,
    config,
  );
}

function readRequiredRuntimeContainerLabel(container: DockerInspectContainerResult, labelName: string): string {
  const value: string | undefined = container.labels[labelName];
  if (!hasText(value)) {
    throw new Error(`Runtime container ${container.containerId} is missing required runtime label ${labelName}.`);
  }

  return value;
}
