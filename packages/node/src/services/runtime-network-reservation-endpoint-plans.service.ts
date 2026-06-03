import type { NodeRuntimeNetworkReservationRequest } from '@compartment/contracts';
import type { RuntimeNetworkCapacityConfig, RuntimeNetworkSpec } from './runtime-network-capacity.types';
import { assertNewRuntimeNetworkEndpointCapacity } from './runtime-network-create.service';
import { assertRuntimeNetworkEndpointCapacity } from './runtime-network-endpoint-capacity.service';
import {
  countRuntimeNetworkEndpointReservations,
  type RuntimeNetworkEndpointReservationPlan,
} from './runtime-network-endpoint-reservation.service';
import type { RuntimeNetworkReservationPlan } from './runtime-network-reservation-plans.service';

const resourceNetworkDeploymentReservationEndpointCount: number = 1;

export function buildRuntimeNetworkEndpointReservationPlans(
  input: NodeRuntimeNetworkReservationRequest,
  plans: RuntimeNetworkReservationPlan[],
): RuntimeNetworkEndpointReservationPlan[] {
  return plans.flatMap((plan: RuntimeNetworkReservationPlan): RuntimeNetworkEndpointReservationPlan[] => {
    const endpointReservations: number = readRuntimeNetworkEndpointReservationCount(input, plan.input.spec);
    return endpointReservations > 0 ? [{ endpointReservations, spec: plan.input.spec }] : [];
  });
}

export async function assertRuntimeNetworkReservationEndpointCapacity(
  endpointPlans: RuntimeNetworkEndpointReservationPlan[],
  plans: RuntimeNetworkReservationPlan[],
  config: RuntimeNetworkCapacityConfig,
): Promise<void> {
  for (const plan of plans) {
    await assertRuntimeNetworkReservationPlanEndpointCapacity(plan, endpointPlans, config);
  }
}

async function assertRuntimeNetworkReservationPlanEndpointCapacity(
  plan: RuntimeNetworkReservationPlan,
  endpointPlans: RuntimeNetworkEndpointReservationPlan[],
  config: RuntimeNetworkCapacityConfig,
): Promise<void> {
  const endpointReservations: number = readPlannedEndpointReservationCount(plan.input.spec, endpointPlans);
  if (plan.kind === 'create') {
    assertNewRuntimeNetworkEndpointCapacity(
      plan.input.spec,
      plan.subnet,
      readNewRuntimeNetworkRequiredEndpointCount(plan.input.spec, endpointReservations),
    );
    return;
  }

  await assertRuntimeNetworkEndpointCapacity(
    {
      networkName: plan.input.spec.networkName,
      reason: 'deployment reservation',
      reservedEndpointCount: await countRuntimeNetworkEndpointReservations(plan.input.spec.networkName, config),
      requiredFreeEndpoints: endpointReservations,
      spec: plan.input.spec,
    },
    config,
  );
}

function readRuntimeNetworkEndpointReservationCount(
  input: NodeRuntimeNetworkReservationRequest,
  spec: RuntimeNetworkSpec,
): number {
  return spec.kind === 'service'
    ? input.serviceNetworkEndpointReservations
    : resourceNetworkDeploymentReservationEndpointCount;
}

function readPlannedEndpointReservationCount(
  spec: RuntimeNetworkSpec,
  endpointPlans: RuntimeNetworkEndpointReservationPlan[],
): number {
  return (
    endpointPlans.find(
      (plan: RuntimeNetworkEndpointReservationPlan): boolean => plan.spec.networkName === spec.networkName,
    )?.endpointReservations ?? 0
  );
}

function readNewRuntimeNetworkRequiredEndpointCount(spec: RuntimeNetworkSpec, endpointReservations: number): number {
  return spec.kind === 'service' ? endpointReservations + 1 : endpointReservations;
}
