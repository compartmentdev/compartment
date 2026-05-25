import {
  compartmentDockerNamespaceLabelName,
  connectDockerContainerToNetwork,
  disconnectDockerContainerFromNetwork,
  inspectDockerContainer,
  inspectDockerNetwork,
  listDockerContainers,
  listDockerNetworks,
  removeDockerNetwork,
  type DockerInspectContainerResult,
  type DockerInspectNetworkResult,
  type DockerListContainerResult,
  type DockerListNetworkResult,
  type DockerNetworkAttachment,
} from '@compartment/docker';
import type { NodeDeployRequest } from '@compartment/contracts';
import { buildRuntimeServiceNetworkName, buildSystemNetworkName, isRuntimeNetworkName } from './runtime-names.service';
import {
  syncCurrentRuntimeNetworkEgressDenyRules,
  syncDesiredRuntimeNetworkEgressDenyRules,
} from './runtime-network-egress.service';
import { readDesiredRuntimeNetworkNames, type DesiredRuntimeNetworkNames } from './runtime-network-desired.service';
import {
  assertCompatibleRuntimeNetwork,
  ensureCompatibleRuntimeNetwork,
  isCompatibleRuntimeNetwork,
} from './runtime-network-ownership.service';
import type { RuntimeConnectivityMode } from './runtime.types';

const dockerComposeProjectLabelName: string = 'com.docker.compose.project';
const dockerComposeServiceLabelName: string = 'com.docker.compose.service';

export interface RuntimeNetworkActors {
  readonly caddyContainerId: string;
}

interface RuntimeNetworkConfig {
  dockerNamespace: string;
  runtimeConnectivityMode: RuntimeConnectivityMode;
}

export interface RuntimeNetworkReconcileOptions {
  readonly disconnectCaddyStaleNetworks?: boolean | undefined;
}

interface RuntimeNetworkSyncOptions {
  readonly disconnectStaleNetworks: boolean;
}

export async function ensureRuntimeNetworkForDeployment(
  config: RuntimeNetworkConfig,
  input: Pick<NodeDeployRequest, 'environmentId' | 'projectId' | 'serviceId'>,
): Promise<string> {
  const networkName: string = buildRuntimeServiceNetworkName(input, config.dockerNamespace);
  await ensureCompatibleRuntimeNetwork({ dockerNamespace: config.dockerNamespace, networkName });

  const actors: RuntimeNetworkActors = await resolveRuntimeNetworkActors(config);
  await connectDockerContainerToNetwork({ containerRef: actors.caddyContainerId, networkName });
  await syncCurrentRuntimeNetworkEgressDenyRules(config, [networkName], {
    platformSourceContainerRefs: [actors.caddyContainerId],
  });

  return networkName;
}

export async function reconcileRuntimeNetworks(
  config: RuntimeNetworkConfig,
  options: RuntimeNetworkReconcileOptions = {},
): Promise<void> {
  if (config.runtimeConnectivityMode !== 'network') {
    return;
  }

  const actors: RuntimeNetworkActors = await resolveRuntimeNetworkActors(config);
  const desiredNetworkNames: DesiredRuntimeNetworkNames = await readDesiredRuntimeNetworkNames(config);
  const staleNetworkNames: Set<string> = new Set<string>();

  await syncCaddyRuntimeNetworkAttachments(actors, desiredNetworkNames, config, staleNetworkNames, options);
  await syncDesiredRuntimeNetworkEgressDenyRules(config, desiredNetworkNames, [], {
    platformSourceContainerRefs: [actors.caddyContainerId],
  });
  await addStaleRuntimeNetworksFromDocker(desiredNetworkNames, config, staleNetworkNames);
  await removeEmptyRuntimeNetworks(staleNetworkNames, config);
}

async function syncCaddyRuntimeNetworkAttachments(
  actors: RuntimeNetworkActors,
  desiredNetworkNames: DesiredRuntimeNetworkNames,
  config: RuntimeNetworkConfig,
  staleNetworkNames: Set<string>,
  options: RuntimeNetworkReconcileOptions,
): Promise<void> {
  await syncRuntimeNetworkAttachments(
    actors.caddyContainerId,
    desiredNetworkNames.serviceNetworkNames,
    config,
    staleNetworkNames,
    {
      disconnectStaleNetworks: options.disconnectCaddyStaleNetworks ?? true,
    },
  );
}

export async function resolveRuntimeNetworkActors(config: RuntimeNetworkConfig): Promise<RuntimeNetworkActors> {
  const caddyContainers: DockerListContainerResult[] = await listDockerContainers({
    labelFilters: {
      [dockerComposeProjectLabelName]: config.dockerNamespace,
      [dockerComposeServiceLabelName]: 'caddy',
    },
  });
  const caddyContainerId: string | undefined = caddyContainers[0]?.containerId;
  if (caddyContainers.length !== 1 || caddyContainerId === undefined) {
    throw new Error(`Expected one running caddy container for docker namespace ${config.dockerNamespace}.`);
  }

  return {
    caddyContainerId,
  };
}

async function syncRuntimeNetworkAttachments(
  containerRef: string,
  desiredNetworkNames: Set<string>,
  config: RuntimeNetworkConfig,
  staleNetworkNames: Set<string>,
  options: RuntimeNetworkSyncOptions,
): Promise<void> {
  const currentRuntimeNetworks: Set<string> = await readManagedRuntimeNetworks(
    containerRef,
    desiredNetworkNames,
    config,
  );
  await connectMissingRuntimeNetworks(containerRef, desiredNetworkNames, currentRuntimeNetworks, config);
  if (!options.disconnectStaleNetworks) {
    return;
  }
  await disconnectStaleRuntimeNetworks(containerRef, desiredNetworkNames, currentRuntimeNetworks, staleNetworkNames);
}

async function removeEmptyRuntimeNetworks(networkNames: Set<string>, config: RuntimeNetworkConfig): Promise<void> {
  for (const networkName of networkNames) {
    const network: DockerInspectNetworkResult | null = await inspectDockerNetwork({ networkName });
    if (network !== null && isOwnedRuntimeNetwork(network, config) && network.endpointContainerIds.length === 0) {
      await removeDockerNetwork({ networkName });
    }
  }
}

async function addStaleRuntimeNetworksFromDocker(
  desiredNetworkNames: DesiredRuntimeNetworkNames,
  config: RuntimeNetworkConfig,
  staleNetworkNames: Set<string>,
): Promise<void> {
  const runtimeNetworkNames: Set<string> = await readDockerRuntimeNetworkNames(config);
  for (const networkName of runtimeNetworkNames) {
    if (
      desiredNetworkNames.serviceNetworkNames.has(networkName) ||
      desiredNetworkNames.resourceNetworkNames.has(networkName)
    ) {
      continue;
    }

    staleNetworkNames.add(networkName);
  }
}

async function readDockerRuntimeNetworkNames(config: RuntimeNetworkConfig): Promise<Set<string>> {
  const networks: DockerListNetworkResult[] = await listDockerNetworks();
  return new Set<string>(
    networks
      .filter((network: DockerListNetworkResult): boolean => isOwnedRuntimeNetwork(network, config))
      .map((network: DockerListNetworkResult): string => network.name),
  );
}

async function readManagedRuntimeNetworks(
  containerRef: string,
  desiredNetworkNames: Set<string>,
  config: RuntimeNetworkConfig,
): Promise<Set<string>> {
  return await filterManagedRuntimeNetworks(
    await readCurrentNonSystemNetworks(containerRef, config),
    desiredNetworkNames,
    config,
  );
}

async function readCurrentNonSystemNetworks(containerRef: string, config: RuntimeNetworkConfig): Promise<Set<string>> {
  const systemNetworkName: string = buildSystemNetworkName(config.dockerNamespace);
  const container: DockerInspectContainerResult | null = await inspectDockerContainer({ containerRef });
  if (container?.networkAttachments === undefined) {
    throw new Error(`Expected docker network attachments for container ${containerRef}.`);
  }

  return new Set<string>(
    container.networkAttachments
      .map((attachment: DockerNetworkAttachment): string => attachment.name)
      .filter((networkName: string): boolean => networkName !== systemNetworkName),
  );
}

async function filterManagedRuntimeNetworks(
  networkNames: Set<string>,
  desiredNetworkNames: Set<string>,
  config: RuntimeNetworkConfig,
): Promise<Set<string>> {
  const managedNetworkNames: Set<string> = new Set<string>();
  for (const networkName of networkNames) {
    if (await isManagedRuntimeNetworkName(networkName, desiredNetworkNames, config)) {
      managedNetworkNames.add(networkName);
    }
  }

  return managedNetworkNames;
}

async function isManagedRuntimeNetworkName(
  networkName: string,
  desiredNetworkNames: Set<string>,
  config: RuntimeNetworkConfig,
): Promise<boolean> {
  if (!isRuntimeNetworkName(networkName, config.dockerNamespace)) {
    return false;
  }

  const network: DockerInspectNetworkResult | null = await inspectDockerNetwork({ networkName });
  if (network !== null) {
    if (isCompatibleRuntimeNetwork({ dockerNamespace: config.dockerNamespace, networkName }, network)) {
      return true;
    }
    if (desiredNetworkNames.has(networkName)) {
      assertCompatibleRuntimeNetwork({ dockerNamespace: config.dockerNamespace, networkName }, network);
    }
  }

  return false;
}

async function connectMissingRuntimeNetworks(
  containerRef: string,
  desiredNetworkNames: Set<string>,
  currentRuntimeNetworks: Set<string>,
  config: RuntimeNetworkConfig,
): Promise<void> {
  for (const networkName of desiredNetworkNames) {
    if (!currentRuntimeNetworks.has(networkName)) {
      await ensureCompatibleRuntimeNetwork({ dockerNamespace: config.dockerNamespace, networkName });
      await connectDockerContainerToNetwork({ containerRef, networkName });
    }
  }
}

async function disconnectStaleRuntimeNetworks(
  containerRef: string,
  desiredNetworkNames: Set<string>,
  currentRuntimeNetworks: Set<string>,
  staleNetworkNames: Set<string>,
): Promise<void> {
  for (const networkName of currentRuntimeNetworks) {
    if (desiredNetworkNames.has(networkName)) {
      continue;
    }

    await disconnectDockerContainerFromNetwork({ containerRef, networkName });
    staleNetworkNames.add(networkName);
  }
}

function isOwnedRuntimeNetwork(
  network: Pick<DockerInspectNetworkResult, 'labels' | 'name'>,
  config: RuntimeNetworkConfig,
): boolean {
  return (
    isRuntimeNetworkName(network.name, config.dockerNamespace) &&
    network.labels[compartmentDockerNamespaceLabelName] === config.dockerNamespace
  );
}
