import {
  inspectDockerNetwork,
  listDockerNetworks,
  removeDockerNetwork,
  type DockerInspectNetworkResult,
  type DockerListNetworkResult,
} from '@compartment/docker';
import {
  isManagedRuntimeNetwork,
  isRuntimeNetworkReservationActive,
  runtimeNetworkReservationIdLabelName,
} from './runtime-network-managed.service';
import type { RuntimeNetworkCapacityConfig } from './runtime-network-capacity.types';
import { projectIdLabelName } from './runtime-container-labels';
import { readDesiredRuntimeNetworkNames, type DesiredRuntimeNetworkNames } from './runtime-network-desired.service';
import { isRuntimeNetworkProtectedByActiveReservation } from './runtime-network-reservation-protection.service';

interface EmptyRuntimeNetworkRemovalOptions {
  removeActiveReservations: boolean;
}

export async function removeExpiredRuntimeNetworkReservations(config: RuntimeNetworkCapacityConfig): Promise<void> {
  const networks: DockerListNetworkResult[] = await listDockerNetworks();
  for (const network of networks) {
    if (!isExpiredRuntimeNetworkReservation(network, config)) {
      continue;
    }
    await removeExpiredRuntimeNetworkReservation(network.name, config);
  }
}

export async function removeEmptyStaleRuntimeNetworks(config: RuntimeNetworkCapacityConfig): Promise<void> {
  const desiredNetworkNames: DesiredRuntimeNetworkNames = await readDesiredRuntimeNetworkNames(config);
  const networks: DockerListNetworkResult[] = await listDockerNetworks();
  for (const network of networks) {
    if (!isRemovableStaleRuntimeNetwork(network, desiredNetworkNames, config)) {
      continue;
    }

    await removeEmptyRuntimeNetwork(network.name, config, { removeActiveReservations: false });
  }
}

export async function removeEmptyRuntimeNetworkReservations(
  networkNames: readonly string[],
  reservationId: string,
  config: RuntimeNetworkCapacityConfig,
): Promise<void> {
  for (const networkName of networkNames) {
    await removeEmptyRuntimeNetworkReservation(networkName, reservationId, config);
  }
}

export async function removeEmptyRuntimeNetworkReservationsById(
  reservationId: string,
  config: RuntimeNetworkCapacityConfig,
): Promise<void> {
  const networks: DockerListNetworkResult[] = await listDockerNetworks();
  for (const network of networks) {
    if (
      isManagedRuntimeNetwork(network, config.dockerNamespace) &&
      network.labels[runtimeNetworkReservationIdLabelName] === reservationId
    ) {
      await removeEmptyRuntimeNetworkReservation(network.name, reservationId, config);
    }
  }
}

export async function removeEmptyRuntimeNetworkReservationsForProject(
  projectId: string,
  config: RuntimeNetworkCapacityConfig,
): Promise<void> {
  const networks: DockerListNetworkResult[] = await listDockerNetworks();
  for (const network of networks) {
    if (
      isManagedRuntimeNetwork(network, config.dockerNamespace) &&
      network.labels[projectIdLabelName] === projectId &&
      network.labels[runtimeNetworkReservationIdLabelName] !== undefined
    ) {
      await removeEmptyRuntimeNetwork(network.name, config, { removeActiveReservations: true });
    }
  }
}

export async function removeEmptyRuntimeNetworkReservation(
  networkName: string,
  reservationId: string,
  config: RuntimeNetworkCapacityConfig,
): Promise<void> {
  const network: DockerInspectNetworkResult | null = await inspectDockerNetwork({ networkName });
  if (
    network === null ||
    !isManagedRuntimeNetwork(network, config.dockerNamespace) ||
    network.labels[runtimeNetworkReservationIdLabelName] !== reservationId ||
    network.endpointContainerIds.length > 0
  ) {
    return;
  }

  await removeDockerNetwork({ networkName });
}

async function removeEmptyRuntimeNetwork(
  networkName: string,
  config: RuntimeNetworkCapacityConfig,
  options: EmptyRuntimeNetworkRemovalOptions,
): Promise<void> {
  const network: DockerInspectNetworkResult | null = await inspectDockerNetwork({ networkName });
  if (
    network !== null &&
    isManagedRuntimeNetwork(network, config.dockerNamespace) &&
    (options.removeActiveReservations || !(await isRuntimeNetworkProtectedByActiveReservation(network, config))) &&
    network.endpointContainerIds.length === 0
  ) {
    await removeDockerNetwork({ networkName });
  }
}

async function removeExpiredRuntimeNetworkReservation(
  networkName: string,
  config: RuntimeNetworkCapacityConfig,
): Promise<void> {
  const network: DockerInspectNetworkResult | null = await inspectDockerNetwork({ networkName });
  if (
    network !== null &&
    isExpiredRuntimeNetworkReservation(network, config) &&
    network.endpointContainerIds.length === 0
  ) {
    await removeDockerNetwork({ networkName });
  }
}

function isExpiredRuntimeNetworkReservation(
  network: Pick<DockerInspectNetworkResult, 'labels' | 'name'>,
  config: RuntimeNetworkCapacityConfig,
): boolean {
  return (
    isManagedRuntimeNetwork(network, config.dockerNamespace) &&
    network.labels[runtimeNetworkReservationIdLabelName] !== undefined &&
    !isRuntimeNetworkReservationActive(network)
  );
}

function isRemovableStaleRuntimeNetwork(
  network: DockerListNetworkResult,
  desiredNetworkNames: DesiredRuntimeNetworkNames,
  config: RuntimeNetworkCapacityConfig,
): boolean {
  return (
    isManagedRuntimeNetwork(network, config.dockerNamespace) &&
    !desiredNetworkNames.serviceNetworkNames.has(network.name) &&
    !desiredNetworkNames.resourceNetworkNames.has(network.name)
  );
}
