import { createHash } from 'node:crypto';
import {
  buildDockerNamespaceLabels,
  ensureDockerVolume,
  listDockerVolumes,
  removeDockerVolume,
  type DockerListVolumeResult,
} from '@compartment/docker';
import { environmentIdLabelName, projectIdLabelName } from './runtime-container-labels';
import type { RuntimeNetworkCapacityConfig, RuntimeNetworkSpec } from './runtime-network-capacity.types';

const runtimeNetworkEndpointReservationLabelName: string = 'compartment.network.endpointReservation';
const runtimeNetworkEndpointReservationExpiresAtLabelName: string = 'compartment.network.endpointReservation.expiresAt';
const runtimeNetworkEndpointReservationIdLabelName: string = 'compartment.network.endpointReservation.id';
const runtimeNetworkEndpointReservationNetworkLabelName: string = 'compartment.network.endpointReservation.network';

const runtimeNetworkEndpointReservationLabelValue: string = 'true';

export interface RuntimeNetworkEndpointReservationPlan {
  endpointReservations: number;
  spec: RuntimeNetworkSpec;
}

interface RuntimeNetworkEndpointReservationContext {
  expiresAt: string;
  reservationId: string;
}

export async function createRuntimeNetworkEndpointReservations(
  plans: readonly RuntimeNetworkEndpointReservationPlan[],
  reservation: RuntimeNetworkEndpointReservationContext,
  config: RuntimeNetworkCapacityConfig,
): Promise<void> {
  for (const plan of plans) {
    for (let index: number = 0; index < plan.endpointReservations; index += 1) {
      await ensureDockerVolume({
        labels: buildRuntimeNetworkEndpointReservationLabels(plan.spec, reservation, config),
        volumeName: buildRuntimeNetworkEndpointReservationVolumeName(plan.spec.networkName, reservation, index, config),
      });
    }
  }
}

export async function hasActiveRuntimeNetworkEndpointReservations(
  networkName: string,
  config: RuntimeNetworkCapacityConfig,
): Promise<boolean> {
  return (await countRuntimeNetworkEndpointReservations(networkName, config)) > 0;
}

export async function countRuntimeNetworkEndpointReservations(
  networkName: string,
  config: RuntimeNetworkCapacityConfig,
): Promise<number> {
  const reservations: DockerListVolumeResult[] = await listRuntimeNetworkEndpointReservationVolumes(config);
  return reservations.filter(
    (reservation: DockerListVolumeResult): boolean =>
      isRuntimeNetworkEndpointReservationActive(reservation) &&
      reservation.labels[runtimeNetworkEndpointReservationNetworkLabelName] === networkName,
  ).length;
}

export async function removeExpiredRuntimeNetworkEndpointReservations(
  config: RuntimeNetworkCapacityConfig,
): Promise<void> {
  const reservations: DockerListVolumeResult[] = await listRuntimeNetworkEndpointReservationVolumes(config);
  for (const reservation of reservations) {
    if (isRuntimeNetworkEndpointReservationActive(reservation)) {
      continue;
    }

    await removeDockerVolume({ volumeName: reservation.name });
  }
}

export async function removeRuntimeNetworkEndpointReservationsById(
  reservationId: string,
  config: RuntimeNetworkCapacityConfig,
): Promise<void> {
  const reservations: DockerListVolumeResult[] = await listRuntimeNetworkEndpointReservationVolumes(config);
  for (const reservation of reservations) {
    if (reservation.labels[runtimeNetworkEndpointReservationIdLabelName] === reservationId) {
      await removeDockerVolume({ volumeName: reservation.name });
    }
  }
}

export async function removeRuntimeNetworkEndpointReservationsForProject(
  projectId: string,
  config: RuntimeNetworkCapacityConfig,
): Promise<void> {
  const reservations: DockerListVolumeResult[] = await listRuntimeNetworkEndpointReservationVolumes(config);
  for (const reservation of reservations) {
    if (reservation.labels[projectIdLabelName] === projectId) {
      await removeDockerVolume({ volumeName: reservation.name });
    }
  }
}

function buildRuntimeNetworkEndpointReservationLabels(
  spec: RuntimeNetworkSpec,
  reservation: RuntimeNetworkEndpointReservationContext,
  config: RuntimeNetworkCapacityConfig,
): Record<string, string> {
  return {
    ...buildDockerNamespaceLabels(config.dockerNamespace),
    [environmentIdLabelName]: spec.environmentId,
    [projectIdLabelName]: spec.projectId,
    [runtimeNetworkEndpointReservationExpiresAtLabelName]: reservation.expiresAt,
    [runtimeNetworkEndpointReservationIdLabelName]: reservation.reservationId,
    [runtimeNetworkEndpointReservationLabelName]: runtimeNetworkEndpointReservationLabelValue,
    [runtimeNetworkEndpointReservationNetworkLabelName]: spec.networkName,
  };
}

function buildRuntimeNetworkEndpointReservationVolumeName(
  networkName: string,
  reservation: RuntimeNetworkEndpointReservationContext,
  index: number,
  config: RuntimeNetworkCapacityConfig,
): string {
  const identity: string = `${networkName}:${reservation.reservationId}:${index.toString()}`;
  const hash: string = createHash('sha256').update(identity).digest('hex').slice(0, 24);
  return `${config.dockerNamespace}-network-endpoint-reservation-${hash}`;
}

async function listRuntimeNetworkEndpointReservationVolumes(
  config: RuntimeNetworkCapacityConfig,
): Promise<DockerListVolumeResult[]> {
  return await listDockerVolumes({
    labelFilters: {
      ...buildDockerNamespaceLabels(config.dockerNamespace),
      [runtimeNetworkEndpointReservationLabelName]: runtimeNetworkEndpointReservationLabelValue,
    },
  });
}

function isRuntimeNetworkEndpointReservationActive(reservation: DockerListVolumeResult): boolean {
  const expiresAt: string | undefined = reservation.labels[runtimeNetworkEndpointReservationExpiresAtLabelName];
  return expiresAt !== undefined && Date.parse(expiresAt) > Date.now();
}
