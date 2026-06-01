import {
  connectDockerContainerToNetwork,
  disconnectDockerContainerFromNetwork,
  inspectDockerContainer,
  type DockerInspectContainerResult,
  type DockerNetworkAttachment,
} from '@compartment/docker';
import type { NodeDeployRequest } from '@compartment/contracts';
import { buildSystemNetworkName } from './runtime-names.service';
import {
  syncCurrentRuntimeNetworkEgressDenyRules,
  syncDesiredRuntimeNetworkEgressDenyRules,
} from './runtime-network-egress.service';
import { readDesiredRuntimeNetworkNames, type DesiredRuntimeNetworkNames } from './runtime-network-desired.service';
import {
  assertRuntimeServiceNetworkFreeEndpoints,
  ensureRuntimeServiceNetwork,
} from './runtime-network-capacity.service';
import { resolveRuntimeNetworkActors, type RuntimeNetworkActors } from './runtime-network-actors.service';
import type { RuntimeNetworkCapacityConfig, RuntimeNetworkSpec } from './runtime-network-capacity.types';
import {
  assertExistingDesiredRuntimeNetwork,
  isCurrentRuntimeNetworkAttachment,
} from './runtime-network-compatibility.service';
import { removeStaleRuntimeNetworks } from './runtime-network-stale-cleanup.service';

type RuntimeNetworkConfig = RuntimeNetworkCapacityConfig;

export interface RuntimeNetworkReconcileOptions {
  readonly disconnectCaddyStaleNetworks?: boolean | undefined;
}

interface RuntimeNetworkSyncOptions {
  readonly disconnectStaleNetworks: boolean;
}

interface RuntimeNetworkAttachmentSyncInput {
  config: RuntimeNetworkConfig;
  containerRef: string;
  desiredNetworkNames: Set<string>;
  desiredNetworkSpecs: Map<string, RuntimeNetworkSpec>;
  options: RuntimeNetworkSyncOptions;
  staleNetworkNames: Set<string>;
}

export async function ensureRuntimeNetworkForDeployment(
  config: RuntimeNetworkConfig,
  input: NodeDeployRequest,
): Promise<string> {
  const networkName: string = await ensureRuntimeServiceNetwork(input, config);

  const actors: RuntimeNetworkActors = await resolveRuntimeNetworkActors(config);
  await connectDockerContainerToNetwork({ containerRef: actors.caddyContainerId, networkName });
  await assertRuntimeServiceNetworkFreeEndpoints(
    input,
    config,
    readDeploymentServiceNetworkRequiredFreeEndpoints(input),
    'starting deployment container',
  );
  await syncCurrentRuntimeNetworkEgressDenyRules(config, [networkName], {
    platformSourceContainerRefs: [actors.caddyContainerId],
  });

  return networkName;
}

function readDeploymentServiceNetworkRequiredFreeEndpoints(input: NodeDeployRequest): number {
  return input.readiness === null ? 1 : 2;
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
  await removeStaleRuntimeNetworks(desiredNetworkNames, staleNetworkNames, config);
}

async function syncCaddyRuntimeNetworkAttachments(
  actors: RuntimeNetworkActors,
  desiredNetworkNames: DesiredRuntimeNetworkNames,
  config: RuntimeNetworkConfig,
  staleNetworkNames: Set<string>,
  options: RuntimeNetworkReconcileOptions,
): Promise<void> {
  await syncRuntimeNetworkAttachments({
    config,
    containerRef: actors.caddyContainerId,
    desiredNetworkNames: desiredNetworkNames.serviceNetworkNames,
    desiredNetworkSpecs: desiredNetworkNames.serviceNetworkSpecs,
    staleNetworkNames,
    options: {
      disconnectStaleNetworks: options.disconnectCaddyStaleNetworks ?? true,
    },
  });
}

async function syncRuntimeNetworkAttachments(input: RuntimeNetworkAttachmentSyncInput): Promise<void> {
  const currentRuntimeNetworks: Set<string> = await readManagedRuntimeNetworks(
    input.containerRef,
    input.desiredNetworkNames,
    input.desiredNetworkSpecs,
    input.config,
  );
  await connectMissingRuntimeNetworks(
    input.containerRef,
    input.desiredNetworkNames,
    input.desiredNetworkSpecs,
    currentRuntimeNetworks,
    input.config,
  );
  await disconnectStaleRuntimeNetworksWhenRequested(
    input.containerRef,
    input.desiredNetworkNames,
    currentRuntimeNetworks,
    input.staleNetworkNames,
    input.options,
  );
}

async function readManagedRuntimeNetworks(
  containerRef: string,
  desiredNetworkNames: Set<string>,
  desiredNetworkSpecs: Map<string, RuntimeNetworkSpec>,
  config: RuntimeNetworkConfig,
): Promise<Set<string>> {
  return await filterManagedRuntimeNetworks(
    await readCurrentNonSystemNetworks(containerRef, config),
    desiredNetworkNames,
    desiredNetworkSpecs,
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
  desiredNetworkSpecs: Map<string, RuntimeNetworkSpec>,
  config: RuntimeNetworkConfig,
): Promise<Set<string>> {
  const managedNetworkNames: Set<string> = new Set<string>();
  for (const networkName of networkNames) {
    if (await isCurrentRuntimeNetworkAttachment(networkName, desiredNetworkNames, desiredNetworkSpecs, config)) {
      managedNetworkNames.add(networkName);
    }
  }

  return managedNetworkNames;
}

async function connectMissingRuntimeNetworks(
  containerRef: string,
  desiredNetworkNames: Set<string>,
  desiredNetworkSpecs: Map<string, RuntimeNetworkSpec>,
  currentRuntimeNetworks: Set<string>,
  config: RuntimeNetworkConfig,
): Promise<void> {
  for (const networkName of desiredNetworkNames) {
    if (!currentRuntimeNetworks.has(networkName)) {
      await assertExistingDesiredRuntimeNetwork(config, networkName, desiredNetworkSpecs);
      await connectDockerContainerToNetwork({ containerRef, networkName });
    }
  }
}

async function disconnectStaleRuntimeNetworksWhenRequested(
  containerRef: string,
  desiredNetworkNames: Set<string>,
  currentRuntimeNetworks: Set<string>,
  staleNetworkNames: Set<string>,
  options: RuntimeNetworkSyncOptions,
): Promise<void> {
  if (options.disconnectStaleNetworks) {
    await disconnectStaleRuntimeNetworks(containerRef, desiredNetworkNames, currentRuntimeNetworks, staleNetworkNames);
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
