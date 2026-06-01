import type {
  NodeRuntimeNetworkReservationCleanupRequest,
  NodeRuntimeNetworkReservationCleanupResponse,
  NodeRuntimeNetworkReservationRequest,
  NodeRuntimeNetworkReservationResponse,
} from '@compartment/contracts';
import type { RuntimeNetworkCapacityConfig, RuntimeNetworkSpec } from './runtime-network-capacity.types';
import { assertRuntimeNetworkEndpointCapacity } from './runtime-network-endpoint-capacity.service';
import { withRuntimeNetworkLock } from './runtime-network-lock.service';
import {
  buildRuntimeNetworkReservationSpecs,
  buildRuntimeResourceNetworkSpec,
  buildRuntimeServiceNetworkSpec,
  type RuntimeResourceNetworkSpecInput,
  type RuntimeServiceNetworkSpecInput,
} from './runtime-network-reservation-specs.service';
import {
  removeEmptyRuntimeNetworkReservation,
  removeEmptyRuntimeNetworkReservations,
  removeEmptyRuntimeNetworkReservationsById,
  removeEmptyStaleRuntimeNetworks,
  removeExpiredRuntimeNetworkReservations,
} from './runtime-network-reservation-cleanup.service';
import {
  buildRuntimeNetworkReservationPlans,
  type RuntimeNetworkReservationPlan,
} from './runtime-network-reservation-plans.service';
import { createManagedRuntimeNetwork, ensureRuntimeNetwork } from './runtime-network-create.service';
import { migrateLegacyRuntimeNetwork } from './runtime-network-migration.service';
import { buildRuntimeResourceNetworkName, buildRuntimeServiceNetworkName } from './runtime-names.service';
import {
  createRuntimeNetworkEndpointReservations,
  removeExpiredRuntimeNetworkEndpointReservations,
  removeRuntimeNetworkEndpointReservationsById,
  type RuntimeNetworkEndpointReservationPlan,
} from './runtime-network-endpoint-reservation.service';
import {
  assertRuntimeNetworkReservationEndpointCapacity,
  buildRuntimeNetworkEndpointReservationPlans,
} from './runtime-network-reservation-endpoint-plans.service';

const runtimeNetworkReservationTtlMs: number = 7_200_000;

interface RuntimeNetworkReservationContext {
  expiresAt: string;
  reservationId: string;
}

export async function reserveRuntimeNetworksForDeployment(
  input: NodeRuntimeNetworkReservationRequest,
  config: RuntimeNetworkCapacityConfig,
): Promise<NodeRuntimeNetworkReservationResponse> {
  return await withRuntimeNetworkLock(
    config.dockerNamespace,
    async (): Promise<NodeRuntimeNetworkReservationResponse> =>
      await reserveRuntimeNetworksForDeploymentLocked(input, config),
  );
}

export async function cleanupRuntimeNetworkReservation(
  input: NodeRuntimeNetworkReservationCleanupRequest,
  config: RuntimeNetworkCapacityConfig,
): Promise<NodeRuntimeNetworkReservationCleanupResponse> {
  await withRuntimeNetworkLock(config.dockerNamespace, async (): Promise<void> => {
    await removeRuntimeNetworkEndpointReservationsById(input.reservationId, config);
    if (input.networkNames.length === 0) {
      await removeEmptyRuntimeNetworkReservationsById(input.reservationId, config);
      return;
    }

    for (const networkName of input.networkNames) {
      await removeEmptyRuntimeNetworkReservation(networkName, input.reservationId, config);
    }
  });

  return {
    cleanedAt: new Date().toISOString(),
  };
}

async function reserveRuntimeNetworksForDeploymentLocked(
  input: NodeRuntimeNetworkReservationRequest,
  config: RuntimeNetworkCapacityConfig,
): Promise<NodeRuntimeNetworkReservationResponse> {
  await prepareRuntimeNetworkCapacityState(config);
  const reservation: RuntimeNetworkReservationContext = createRuntimeNetworkReservationContext(input);
  const plans: RuntimeNetworkReservationPlan[] = await buildRuntimeNetworkReservationPlans(
    buildRuntimeNetworkReservationSpecs(input, config),
    { reservationExpiresAt: reservation.expiresAt, reservationId: reservation.reservationId },
    config,
  );
  const endpointPlans: RuntimeNetworkEndpointReservationPlan[] = buildRuntimeNetworkEndpointReservationPlans(
    input,
    plans,
  );
  await assertRuntimeNetworkReservationEndpointCapacity(endpointPlans, plans, config);

  return {
    ...reservation,
    newlyCreatedNetworkNames: await createRuntimeNetworkReservation(plans, endpointPlans, reservation, config),
    reservedNetworkNames: plans.map((plan: RuntimeNetworkReservationPlan): string => plan.input.spec.networkName),
  };
}

function createRuntimeNetworkReservationContext(
  input: NodeRuntimeNetworkReservationRequest,
): RuntimeNetworkReservationContext {
  return {
    expiresAt: new Date(Date.now() + runtimeNetworkReservationTtlMs).toISOString(),
    reservationId: input.deploymentId,
  };
}

async function createRuntimeNetworkReservation(
  plans: RuntimeNetworkReservationPlan[],
  endpointPlans: RuntimeNetworkEndpointReservationPlan[],
  reservation: RuntimeNetworkReservationContext,
  config: RuntimeNetworkCapacityConfig,
): Promise<string[]> {
  const newlyCreatedNetworkNames: string[] = [];
  try {
    await createMissingRuntimeNetworkReservations(plans, newlyCreatedNetworkNames, config);
    await createRuntimeNetworkEndpointReservations(endpointPlans, reservation, config);
    return newlyCreatedNetworkNames;
  } catch (error) {
    await removeRuntimeNetworkEndpointReservationsById(reservation.reservationId, config);
    await removeEmptyRuntimeNetworkReservations(newlyCreatedNetworkNames, reservation.reservationId, config);
    throw error;
  }
}

async function createMissingRuntimeNetworkReservations(
  plans: RuntimeNetworkReservationPlan[],
  newlyCreatedNetworkNames: string[],
  config: RuntimeNetworkCapacityConfig,
): Promise<void> {
  for (const plan of plans) {
    if (plan.subnet === undefined) {
      continue;
    }
    if (plan.existingLegacyNetwork !== undefined) {
      await migrateLegacyRuntimeNetwork(plan.input, plan.existingLegacyNetwork, config, plan.subnet);
    } else {
      await createManagedRuntimeNetwork(plan.input, config, plan.subnet);
    }
    newlyCreatedNetworkNames.push(plan.input.spec.networkName);
  }
}

export async function ensureRuntimeServiceNetwork(
  input: RuntimeServiceNetworkSpecInput,
  config: RuntimeNetworkCapacityConfig,
): Promise<string> {
  const spec: RuntimeNetworkSpec = buildRuntimeServiceNetworkSpec(input, config);
  await withRuntimeNetworkLock(config.dockerNamespace, async (): Promise<void> => {
    await prepareRuntimeNetworkCapacityState(config);
    await ensureRuntimeNetwork(
      {
        spec,
      },
      config,
    );
  });

  return spec.networkName;
}

export async function ensureRuntimeResourceNetwork(
  input: RuntimeResourceNetworkSpecInput,
  config: RuntimeNetworkCapacityConfig,
): Promise<string> {
  const spec: RuntimeNetworkSpec = buildRuntimeResourceNetworkSpec(input, config);
  await withRuntimeNetworkLock(config.dockerNamespace, async (): Promise<void> => {
    await prepareRuntimeNetworkCapacityState(config);
    await ensureRuntimeNetwork(
      {
        spec,
      },
      config,
    );
  });

  return spec.networkName;
}

export async function assertRuntimeServiceNetworkFreeEndpoints(
  input: RuntimeServiceNetworkSpecInput,
  config: RuntimeNetworkCapacityConfig,
  requiredFreeEndpoints: number,
  reason: string,
): Promise<void> {
  await assertRuntimeNetworkEndpointCapacity(
    {
      networkName: buildRuntimeServiceNetworkName(input, config.dockerNamespace),
      reason,
      requiredFreeEndpoints,
      spec: buildRuntimeServiceNetworkSpec(input, config),
    },
    config,
  );
}

export async function assertRuntimeResourceNetworkFreeEndpoints(
  input: RuntimeResourceNetworkSpecInput,
  config: RuntimeNetworkCapacityConfig,
  requiredFreeEndpoints: number,
  reason: string,
): Promise<void> {
  await assertRuntimeNetworkEndpointCapacity(
    {
      networkName: buildRuntimeResourceNetworkName(input, config.dockerNamespace),
      reason,
      requiredFreeEndpoints,
      spec: buildRuntimeResourceNetworkSpec(input, config),
    },
    config,
  );
}

async function prepareRuntimeNetworkCapacityState(config: RuntimeNetworkCapacityConfig): Promise<void> {
  await removeExpiredRuntimeNetworkEndpointReservations(config);
  await removeExpiredRuntimeNetworkReservations(config);
  await removeEmptyStaleRuntimeNetworks(config);
}
