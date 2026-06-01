import type { DockerInspectNetworkResult } from '@compartment/docker';
import { isRuntimeNetworkReservationActive } from './runtime-network-managed.service';
import type { RuntimeNetworkCapacityConfig } from './runtime-network-capacity.types';
import { hasActiveRuntimeNetworkEndpointReservations } from './runtime-network-endpoint-reservation.service';

export async function isRuntimeNetworkProtectedByActiveReservation(
  network: DockerInspectNetworkResult,
  config: RuntimeNetworkCapacityConfig,
): Promise<boolean> {
  return (
    isRuntimeNetworkReservationActive(network) &&
    (await hasActiveRuntimeNetworkEndpointReservations(network.name, config))
  );
}
