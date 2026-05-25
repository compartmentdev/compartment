import {
  compartmentDockerNamespaceLabelName,
  listDockerContainers,
  type DockerListContainerResult,
} from '@compartment/docker';
import { hasText } from '@compartment/utils';
import {
  deploymentIdLabelName,
  environmentIdLabelName,
  projectIdLabelName,
  releaseContainerLabelName,
  serviceIdLabelName,
} from './runtime-container-labels';
import { buildRuntimeResourceNetworkName, buildRuntimeServiceNetworkName } from './runtime-names.service';
import { resourceNameLabelName } from './runtime-resource-labels';

interface RuntimeNetworkDesiredConfig {
  dockerNamespace: string;
}

export interface DesiredRuntimeNetworkNames {
  resourceNetworkNames: Set<string>;
  serviceNetworkNames: Set<string>;
}

export async function readDesiredRuntimeNetworkNames(
  config: RuntimeNetworkDesiredConfig,
): Promise<DesiredRuntimeNetworkNames> {
  const containers: DockerListContainerResult[] = await listDockerContainers({
    labelFilters: {
      [compartmentDockerNamespaceLabelName]: config.dockerNamespace,
    },
  });
  const networkNames: DesiredRuntimeNetworkNames = {
    resourceNetworkNames: new Set<string>(),
    serviceNetworkNames: new Set<string>(),
  };

  for (const container of containers) {
    if (isManagedServiceRuntimeContainer(container)) {
      addDesiredServiceRuntimeNetworkNames(networkNames.serviceNetworkNames, container, config);
    }
    if (isManagedResourceRuntimeContainer(container)) {
      addDesiredResourceRuntimeNetworkNames(networkNames.resourceNetworkNames, container, config);
    }
  }

  return networkNames;
}

function isManagedServiceRuntimeContainer(container: DockerListContainerResult): boolean {
  return (
    container.isRunning &&
    container.labels[releaseContainerLabelName] !== 'true' &&
    hasText(container.labels[deploymentIdLabelName])
  );
}

function isManagedResourceRuntimeContainer(container: DockerListContainerResult): boolean {
  return container.isRunning && hasText(container.labels[resourceNameLabelName]);
}

function addDesiredServiceRuntimeNetworkNames(
  networkNames: Set<string>,
  container: DockerListContainerResult,
  config: RuntimeNetworkDesiredConfig,
): void {
  networkNames.add(readServiceRuntimeNetworkName(container, config));
}

function addDesiredResourceRuntimeNetworkNames(
  networkNames: Set<string>,
  container: DockerListContainerResult,
  config: RuntimeNetworkDesiredConfig,
): void {
  const networkName: string | null = readResourceRuntimeNetworkName(container, config);
  if (networkName !== null) {
    networkNames.add(networkName);
  }
}

function readResourceRuntimeNetworkName(
  container: DockerListContainerResult,
  config: RuntimeNetworkDesiredConfig,
): string | null {
  const projectId: string | undefined = container.labels[projectIdLabelName];
  const environmentId: string | undefined = container.labels[environmentIdLabelName];
  if (!hasText(projectId) || !hasText(environmentId)) {
    return null;
  }

  return buildRuntimeResourceNetworkName({ environmentId, projectId }, config.dockerNamespace);
}

function readServiceRuntimeNetworkName(
  container: DockerListContainerResult,
  config: RuntimeNetworkDesiredConfig,
): string {
  const projectId: string | undefined = container.labels[projectIdLabelName];
  const environmentId: string | undefined = container.labels[environmentIdLabelName];
  const serviceId: string | undefined = container.labels[serviceIdLabelName];
  if (!hasText(projectId) || !hasText(environmentId) || !hasText(serviceId)) {
    throw new Error(
      `Runtime container ${container.containerId} is missing required runtime labels: ${projectIdLabelName}, ${environmentIdLabelName}, ${serviceIdLabelName}.`,
    );
  }

  return buildRuntimeServiceNetworkName(
    {
      environmentId,
      projectId,
      serviceId,
    },
    config.dockerNamespace,
  );
}
