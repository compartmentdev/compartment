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
import type { RuntimeNetworkSpec } from './runtime-network-capacity.types';
import { resourceNameLabelName } from './runtime-resource-labels';

interface RuntimeNetworkDesiredConfig {
  dockerNamespace: string;
}

interface RuntimeServiceContainerLabels {
  environmentId: string;
  projectId: string;
  serviceId: string;
}

export interface DesiredRuntimeNetworkNames {
  resourceNetworkNames: Set<string>;
  resourceNetworkSpecs: Map<string, RuntimeNetworkSpec>;
  serviceNetworkNames: Set<string>;
  serviceNetworkSpecs: Map<string, RuntimeNetworkSpec>;
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
    resourceNetworkSpecs: new Map<string, RuntimeNetworkSpec>(),
    serviceNetworkNames: new Set<string>(),
    serviceNetworkSpecs: new Map<string, RuntimeNetworkSpec>(),
  };

  for (const container of containers) {
    if (isManagedServiceRuntimeContainer(container)) {
      addDesiredServiceRuntimeNetworkNames(networkNames, container, config);
    }
    if (isManagedResourceRuntimeContainer(container)) {
      addDesiredResourceRuntimeNetworkNames(networkNames, container, config);
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
  networkNames: DesiredRuntimeNetworkNames,
  container: DockerListContainerResult,
  config: RuntimeNetworkDesiredConfig,
): void {
  const spec: RuntimeNetworkSpec = readServiceRuntimeNetworkSpec(container, config);
  networkNames.serviceNetworkNames.add(spec.networkName);
  networkNames.serviceNetworkSpecs.set(spec.networkName, spec);
}

function addDesiredResourceRuntimeNetworkNames(
  networkNames: DesiredRuntimeNetworkNames,
  container: DockerListContainerResult,
  config: RuntimeNetworkDesiredConfig,
): void {
  const spec: RuntimeNetworkSpec | null = readResourceRuntimeNetworkSpec(container, config);
  if (spec !== null) {
    networkNames.resourceNetworkNames.add(spec.networkName);
    networkNames.resourceNetworkSpecs.set(spec.networkName, spec);
  }
}

function readResourceRuntimeNetworkSpec(
  container: DockerListContainerResult,
  config: RuntimeNetworkDesiredConfig,
): RuntimeNetworkSpec | null {
  const projectId: string | undefined = container.labels[projectIdLabelName];
  const environmentId: string | undefined = container.labels[environmentIdLabelName];
  if (!hasText(projectId) || !hasText(environmentId)) {
    return null;
  }

  return {
    environmentId,
    kind: 'resource',
    networkName: buildRuntimeResourceNetworkName({ environmentId, projectId }, config.dockerNamespace),
    projectId,
  };
}

function readServiceRuntimeNetworkSpec(
  container: DockerListContainerResult,
  config: RuntimeNetworkDesiredConfig,
): RuntimeNetworkSpec {
  const labels: RuntimeServiceContainerLabels = readRuntimeServiceContainerLabels(container);

  return {
    environmentId: labels.environmentId,
    kind: 'service',
    networkName: buildRuntimeServiceNetworkName(
      {
        environmentId: labels.environmentId,
        projectId: labels.projectId,
        serviceId: labels.serviceId,
      },
      config.dockerNamespace,
    ),
    projectId: labels.projectId,
    serviceId: labels.serviceId,
  };
}

function readRuntimeServiceContainerLabels(container: DockerListContainerResult): RuntimeServiceContainerLabels {
  const projectId: string | undefined = container.labels[projectIdLabelName];
  const environmentId: string | undefined = container.labels[environmentIdLabelName];
  const serviceId: string | undefined = container.labels[serviceIdLabelName];
  if (!hasText(projectId) || !hasText(environmentId) || !hasText(serviceId)) {
    throw new Error(
      `Runtime container ${container.containerId} is missing required runtime labels: ${projectIdLabelName}, ${environmentIdLabelName}, ${serviceIdLabelName}.`,
    );
  }

  return { environmentId, projectId, serviceId };
}
