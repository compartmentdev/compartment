import {
  disconnectDockerContainerFromNetwork,
  inspectDockerContainer,
  inspectDockerNetwork,
  listDockerNetworks,
  removeDockerNetwork,
  type DockerInspectContainerResult,
  type DockerInspectNetworkResult,
  type DockerListNetworkResult,
} from '@compartment/docker';
import { hasText } from '@compartment/utils';
import {
  deploymentIdLabelName,
  environmentIdLabelName,
  projectIdLabelName,
  releaseContainerLabelName,
  serviceIdLabelName,
} from './runtime-container-labels';
import { isLegacyRuntimeNetwork } from './runtime-network-managed.service';
import { migrateLegacyRuntimeNetwork } from './runtime-network-migration.service';
import {
  buildRuntimeNetworkReservationPlans,
  type RuntimeNetworkReservationPlan,
} from './runtime-network-reservation-plans.service';
import { allocateRuntimeNetworkSubnet } from './runtime-network-subnet-allocation.service';
import { buildRuntimeResourceNetworkName, buildRuntimeServiceNetworkName } from './runtime-names.service';
import { resourceNameLabelName } from './runtime-resource-labels';
import type { RuntimeNetworkCapacityConfig, RuntimeNetworkSpec } from './runtime-network-capacity.types';
import type { Ipv4Cidr } from './runtime-network-cidr.service';

interface LegacyRuntimeNetworkSpecs {
  resourceSpecsByName: Map<string, RuntimeNetworkSpec>;
  serviceSpecsByName: Map<string, RuntimeNetworkSpec>;
}

export async function migrateLegacyRuntimeNetworksOnStartup(config: RuntimeNetworkCapacityConfig): Promise<void> {
  const legacyNetworks: DockerListNetworkResult[] = (await listDockerNetworks()).filter(
    (network: DockerListNetworkResult): boolean => isLegacyRuntimeNetwork(network, config.dockerNamespace),
  );

  for (const legacyNetwork of legacyNetworks) {
    await migrateLegacyRuntimeNetworkOnStartup(legacyNetwork.name, config);
  }
}

async function migrateLegacyRuntimeNetworkOnStartup(
  networkName: string,
  config: RuntimeNetworkCapacityConfig,
): Promise<void> {
  const network: DockerInspectNetworkResult | null = await inspectDockerNetwork({ networkName });
  if (network === null || !isLegacyRuntimeNetwork(network, config.dockerNamespace)) {
    return;
  }

  const desiredSpec: RuntimeNetworkSpec | undefined = await readLegacyRuntimeNetworkDesiredSpec(network, config);
  if (desiredSpec === undefined) {
    await removeEmptyLegacyRuntimeNetwork(network);
    return;
  }

  const subnet: Ipv4Cidr = await allocateLegacyRuntimeNetworkMigrationSubnet(network, desiredSpec, config);

  await migrateLegacyRuntimeNetwork({ spec: desiredSpec }, network, config, subnet);
}

async function removeEmptyLegacyRuntimeNetwork(network: DockerInspectNetworkResult): Promise<void> {
  if (network.endpointContainerIds.length === 0) {
    await removeDockerNetwork({ networkName: network.name });
    return;
  }

  for (const containerId of network.endpointContainerIds) {
    await disconnectDockerContainerFromNetwork({ containerRef: containerId, networkName: network.name });
  }
  await removeDockerNetwork({ networkName: network.name });
}

async function allocateLegacyRuntimeNetworkMigrationSubnet(
  network: DockerInspectNetworkResult,
  desiredSpec: RuntimeNetworkSpec,
  config: RuntimeNetworkCapacityConfig,
): Promise<Ipv4Cidr> {
  if (network.name !== desiredSpec.networkName) {
    return await allocateRuntimeNetworkSubnet(config.runtimeNetworkPool);
  }

  const [plan]: RuntimeNetworkReservationPlan[] = await buildRuntimeNetworkReservationPlans([desiredSpec], {}, config);
  if (plan?.subnet === undefined || plan.existingLegacyNetwork === undefined) {
    throw new Error(`Expected legacy Docker runtime network ${network.name} to have a migration plan.`);
  }

  return plan.subnet;
}

async function readLegacyRuntimeNetworkDesiredSpec(
  network: DockerInspectNetworkResult,
  config: RuntimeNetworkCapacityConfig,
): Promise<RuntimeNetworkSpec | undefined> {
  return readPreferredLegacyRuntimeNetworkSpec(
    network.name,
    await readLegacyRuntimeNetworkEndpointSpecs(network, config),
  );
}

async function readLegacyRuntimeNetworkEndpointSpecs(
  network: DockerInspectNetworkResult,
  config: RuntimeNetworkCapacityConfig,
): Promise<LegacyRuntimeNetworkSpecs> {
  const resourceSpecsByName: Map<string, RuntimeNetworkSpec> = new Map<string, RuntimeNetworkSpec>();
  const serviceSpecsByName: Map<string, RuntimeNetworkSpec> = new Map<string, RuntimeNetworkSpec>();
  for (const containerId of network.endpointContainerIds) {
    const container: DockerInspectContainerResult | null = await inspectDockerContainer({ containerRef: containerId });
    const spec: RuntimeNetworkSpec | undefined =
      container === null ? undefined : readRuntimeNetworkSpecFromContainer(container, config);
    if (spec !== undefined) {
      addLegacyRuntimeNetworkEndpointSpec(spec, { resourceSpecsByName, serviceSpecsByName });
    }
  }

  return { resourceSpecsByName, serviceSpecsByName };
}

function addLegacyRuntimeNetworkEndpointSpec(spec: RuntimeNetworkSpec, specs: LegacyRuntimeNetworkSpecs): void {
  if (spec.kind === 'resource') {
    specs.resourceSpecsByName.set(spec.networkName, spec);
    return;
  }

  specs.serviceSpecsByName.set(spec.networkName, spec);
}

function readPreferredLegacyRuntimeNetworkSpec(
  networkName: string,
  specs: LegacyRuntimeNetworkSpecs,
): RuntimeNetworkSpec | undefined {
  assertSingleLegacyRuntimeNetworkSpec(networkName, specs.resourceSpecsByName);
  const [resourceSpec]: RuntimeNetworkSpec[] = [...specs.resourceSpecsByName.values()];
  if (resourceSpec !== undefined) {
    return resourceSpec;
  }

  assertSingleLegacyRuntimeNetworkSpec(networkName, specs.serviceSpecsByName);
  return [...specs.serviceSpecsByName.values()][0];
}

function assertSingleLegacyRuntimeNetworkSpec(networkName: string, specsByName: Map<string, RuntimeNetworkSpec>): void {
  if (specsByName.size > 1) {
    throw new Error(`Legacy Docker runtime network ${networkName} has endpoints for multiple runtime networks.`);
  }
}

function readRuntimeNetworkSpecFromContainer(
  container: DockerInspectContainerResult,
  config: RuntimeNetworkCapacityConfig,
): RuntimeNetworkSpec | undefined {
  if (isRuntimeServiceContainer(container)) {
    return readRuntimeServiceNetworkSpecFromContainer(container, config);
  }
  if (isRuntimeResourceContainer(container)) {
    return readRuntimeResourceNetworkSpecFromContainer(container, config);
  }

  return undefined;
}

function isRuntimeServiceContainer(container: DockerInspectContainerResult): boolean {
  return (
    container.isRunning &&
    container.labels[releaseContainerLabelName] !== 'true' &&
    hasText(container.labels[deploymentIdLabelName])
  );
}

function isRuntimeResourceContainer(container: DockerInspectContainerResult): boolean {
  return container.isRunning && hasText(container.labels[resourceNameLabelName]);
}

function readRuntimeServiceNetworkSpecFromContainer(
  container: DockerInspectContainerResult,
  config: RuntimeNetworkCapacityConfig,
): RuntimeNetworkSpec | undefined {
  const environmentId: string | undefined = container.labels[environmentIdLabelName];
  const projectId: string | undefined = container.labels[projectIdLabelName];
  const serviceId: string | undefined = container.labels[serviceIdLabelName];
  if (!hasText(environmentId) || !hasText(projectId) || !hasText(serviceId)) {
    return undefined;
  }

  return {
    environmentId,
    kind: 'service',
    networkName: buildRuntimeServiceNetworkName({ environmentId, projectId, serviceId }, config.dockerNamespace),
    projectId,
    serviceId,
  };
}

function readRuntimeResourceNetworkSpecFromContainer(
  container: DockerInspectContainerResult,
  config: RuntimeNetworkCapacityConfig,
): RuntimeNetworkSpec | undefined {
  const environmentId: string | undefined = container.labels[environmentIdLabelName];
  const projectId: string | undefined = container.labels[projectIdLabelName];
  if (!hasText(environmentId) || !hasText(projectId)) {
    return undefined;
  }

  return {
    environmentId,
    kind: 'resource',
    networkName: buildRuntimeResourceNetworkName({ environmentId, projectId }, config.dockerNamespace),
    projectId,
  };
}
