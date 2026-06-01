import {
  connectDockerContainerToNetwork,
  disconnectDockerContainerFromNetwork,
  ensureDockerNetwork,
  readDockerEngineErrorMessage,
  removeDockerNetwork,
  type DockerEngineError,
  type DockerInspectNetworkResult,
  type DockerNetworkIpamConfig,
} from '@compartment/docker';
import { createRuntimeDockerError } from '../errors/node-runtime-error';
import { formatIpv4Cidr, parseIpv4Cidr, type Ipv4Cidr } from './runtime-network-cidr.service';
import { buildRuntimeNetworkLabels, isLegacyRuntimeNetwork } from './runtime-network-managed.service';
import { assertRuntimeNetworkSubnetEndpointCapacity } from './runtime-network-endpoint-capacity.service';
import type { RuntimeNetworkCapacityConfig, RuntimeNetworkCreateInput } from './runtime-network-capacity.types';
import {
  readRuntimeNetworkMigrationParticipants,
  type RuntimeNetworkMigrationParticipant,
} from './runtime-network-migration-participants.service';

interface LegacyRuntimeNetworkIpamInput {
  ipam?: { subnet: string } | undefined;
}

export async function migrateLegacyRuntimeNetwork(
  input: RuntimeNetworkCreateInput,
  network: DockerInspectNetworkResult,
  config: RuntimeNetworkCapacityConfig,
  subnet: Ipv4Cidr,
): Promise<void> {
  assertLegacyRuntimeNetworkMigrationInput(input, network, config, subnet);
  const participants: RuntimeNetworkMigrationParticipant[] = await readRuntimeNetworkMigrationParticipants(
    network,
    input.spec.kind,
  );
  if (network.name === input.spec.networkName) {
    await replaceSameNameLegacyRuntimeNetwork(input, network, participants, config, subnet);
    return;
  }

  await migrateRenamedLegacyRuntimeNetwork(input, network, participants, config, subnet);
}

export function readRuntimeNetworkIpamCidrs(network: DockerInspectNetworkResult): Ipv4Cidr[] {
  return network.ipamConfigs.flatMap((config: DockerNetworkIpamConfig): Ipv4Cidr[] => {
    try {
      return [parseIpv4Cidr(config.subnet)];
    } catch {
      return [];
    }
  });
}

function assertLegacyRuntimeNetworkMigrationInput(
  input: RuntimeNetworkCreateInput,
  network: DockerInspectNetworkResult,
  config: RuntimeNetworkCapacityConfig,
  subnet: Ipv4Cidr,
): void {
  if (!isLegacyRuntimeNetwork(network, config.dockerNamespace)) {
    throw new Error(`Docker runtime network ${network.name} is not a legacy Compartment runtime network.`);
  }

  assertRuntimeNetworkSubnetEndpointCapacity({
    networkName: input.spec.networkName,
    reason: 'migrating legacy runtime network',
    requiredEndpoints: network.endpointContainerIds.length,
    subnet,
  });
}

async function replaceSameNameLegacyRuntimeNetwork(
  input: RuntimeNetworkCreateInput,
  network: DockerInspectNetworkResult,
  participants: RuntimeNetworkMigrationParticipant[],
  config: RuntimeNetworkCapacityConfig,
  subnet: Ipv4Cidr,
): Promise<void> {
  await disconnectRuntimeNetworkMigrationParticipants(participants, network.name);
  await removeDockerNetwork({ networkName: network.name });
  try {
    await createManagedReplacementNetwork(input, config, subnet);
    await connectRuntimeNetworkMigrationParticipants(participants, input.spec.networkName);
  } catch (error) {
    await disconnectRuntimeNetworkMigrationParticipantsBestEffort(participants, input.spec.networkName);
    await removeManagedReplacementNetworkBestEffort(input.spec.networkName);
    await restoreLegacyRuntimeNetworkBestEffort(network, participants);
    throw error;
  }
}

async function migrateRenamedLegacyRuntimeNetwork(
  input: RuntimeNetworkCreateInput,
  network: DockerInspectNetworkResult,
  participants: RuntimeNetworkMigrationParticipant[],
  config: RuntimeNetworkCapacityConfig,
  subnet: Ipv4Cidr,
): Promise<void> {
  await createManagedReplacementNetwork(input, config, subnet);
  try {
    await connectRuntimeNetworkMigrationParticipants(participants, input.spec.networkName);
  } catch (error) {
    await disconnectRuntimeNetworkMigrationParticipantsBestEffort(participants, input.spec.networkName);
    await removeManagedReplacementNetworkBestEffort(input.spec.networkName);
    throw error;
  }
  await disconnectRuntimeNetworkMigrationParticipants(participants, network.name);
  await removeDockerNetwork({ networkName: network.name });
}

async function restoreLegacyRuntimeNetworkBestEffort(
  network: DockerInspectNetworkResult,
  participants: RuntimeNetworkMigrationParticipant[],
): Promise<void> {
  try {
    await ensureDockerNetwork({
      ...readLegacyRuntimeNetworkIpam(network),
      labels: network.labels,
      networkName: network.name,
    });
    await connectRuntimeNetworkMigrationParticipants(participants, network.name);
  } catch {
    return;
  }
}

async function createManagedReplacementNetwork(
  input: RuntimeNetworkCreateInput,
  config: RuntimeNetworkCapacityConfig,
  subnet: Ipv4Cidr,
): Promise<void> {
  try {
    await ensureDockerNetwork({
      ipam: { subnet: formatIpv4Cidr(subnet) },
      labels: buildRuntimeNetworkLabels(input, config, subnet),
      networkName: input.spec.networkName,
    });
  } catch (error) {
    throw createRuntimeDockerError(readRuntimeNetworkMigrationDockerError(error as DockerEngineError));
  }
}

async function disconnectRuntimeNetworkMigrationParticipantsBestEffort(
  participants: RuntimeNetworkMigrationParticipant[],
  networkName: string,
): Promise<void> {
  try {
    await disconnectRuntimeNetworkMigrationParticipants(participants, networkName);
  } catch {
    return;
  }
}

async function removeManagedReplacementNetworkBestEffort(networkName: string): Promise<void> {
  try {
    await removeDockerNetwork({ networkName });
  } catch {
    return;
  }
}

async function connectRuntimeNetworkMigrationParticipants(
  participants: RuntimeNetworkMigrationParticipant[],
  networkName: string,
): Promise<void> {
  for (const participant of participants) {
    await connectDockerContainerToNetwork({
      ...(participant.aliases !== undefined ? { aliases: participant.aliases } : {}),
      containerRef: participant.containerId,
      networkName,
    });
  }
}

async function disconnectRuntimeNetworkMigrationParticipants(
  participants: RuntimeNetworkMigrationParticipant[],
  networkName: string,
): Promise<void> {
  for (const participant of participants) {
    await disconnectDockerContainerFromNetwork({
      containerRef: participant.containerId,
      networkName,
    });
  }
}

function readLegacyRuntimeNetworkIpam(network: DockerInspectNetworkResult): LegacyRuntimeNetworkIpamInput {
  const subnet: string | undefined = network.ipamConfigs[0]?.subnet;
  return hasText(subnet) ? { ipam: { subnet } } : {};
}

function readRuntimeNetworkMigrationDockerError(error: DockerEngineError): string {
  const message: string = readDockerEngineErrorMessage(error);
  return message === '' ? 'Docker Engine rejected runtime network migration.' : message;
}

function hasText(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '';
}
