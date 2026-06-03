import type { DockerInspectNetworkResult } from '@compartment/docker';
import type { RuntimeNetworkCapacityConfig } from './runtime-network-capacity.types';
import { hasActiveRuntimeNetworkEndpointReservations } from './runtime-network-endpoint-reservation.service';

export async function isRuntimeNetworkProtectedByActiveReservation(
  network: DockerInspectNetworkResult,
  config: RuntimeNetworkCapacityConfig,
): Promise<boolean> {
  return await hasActiveRuntimeNetworkEndpointReservations(network.name, config);
}
