import {
  inspectDockerNetwork,
  listDockerNetworks,
  removeDockerNetwork,
  type DockerInspectNetworkResult,
  type DockerListNetworkResult,
} from '@compartment/docker';
import type { DesiredRuntimeNetworkNames } from './runtime-network-desired.service';
import type { RuntimeNetworkCapacityConfig } from './runtime-network-capacity.types';
import { isOwnedRuntimeNetwork } from './runtime-network-compatibility.service';
import { isRuntimeNetworkProtectedByActiveReservation } from './runtime-network-reservation-protection.service';

export async function removeStaleRuntimeNetworks(
  desiredNetworkNames: DesiredRuntimeNetworkNames,
  staleNetworkNames: Set<string>,
  config: RuntimeNetworkCapacityConfig,
): Promise<void> {
  await addStaleRuntimeNetworksFromDocker(desiredNetworkNames, config, staleNetworkNames);
  await removeEmptyRuntimeNetworks(staleNetworkNames, config);
}

async function addStaleRuntimeNetworksFromDocker(
  desiredNetworkNames: DesiredRuntimeNetworkNames,
  config: RuntimeNetworkCapacityConfig,
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

async function removeEmptyRuntimeNetworks(
  networkNames: Set<string>,
  config: RuntimeNetworkCapacityConfig,
): Promise<void> {
  for (const networkName of networkNames) {
    const network: DockerInspectNetworkResult | null = await inspectDockerNetwork({ networkName });
    if (
      network !== null &&
      isOwnedRuntimeNetwork(network, config) &&
      network.endpointContainerIds.length === 0 &&
      !(await isRuntimeNetworkProtectedByActiveReservation(network, config))
    ) {
      await removeDockerNetwork({ networkName });
    }
  }
}

async function readDockerRuntimeNetworkNames(config: RuntimeNetworkCapacityConfig): Promise<Set<string>> {
  const networks: DockerListNetworkResult[] = await listDockerNetworks();
  return new Set<string>(
    networks
      .filter((network: DockerListNetworkResult): boolean => isOwnedRuntimeNetwork(network, config))
      .map((network: DockerListNetworkResult): string => network.name),
  );
}
