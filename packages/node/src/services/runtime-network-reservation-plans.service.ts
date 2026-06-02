import { inspectDockerNetwork, type DockerInspectNetworkResult } from '@compartment/docker';
import { assertCompatibleExistingRuntimeNetwork } from './runtime-network-managed.service';
import { allocateRuntimeNetworkSubnets } from './runtime-network-subnet-allocation.service';
import type {
  RuntimeNetworkCapacityConfig,
  RuntimeNetworkCreateInput,
  RuntimeNetworkSpec,
} from './runtime-network-capacity.types';
import type { Ipv4Cidr } from './runtime-network-cidr.service';

export interface RuntimeNetworkReservationPlan {
  input: RuntimeNetworkCreateInput;
  subnet?: Ipv4Cidr | undefined;
}

export async function buildRuntimeNetworkReservationPlans(
  specs: RuntimeNetworkSpec[],
  reservation: Pick<RuntimeNetworkCreateInput, 'reservationExpiresAt' | 'reservationId'>,
  config: RuntimeNetworkCapacityConfig,
): Promise<RuntimeNetworkReservationPlan[]> {
  const plans: RuntimeNetworkReservationPlan[] = specs.map(
    (spec: RuntimeNetworkSpec): RuntimeNetworkReservationPlan => ({
      input: {
        ...reservation,
        spec,
      },
    }),
  );
  const missingPlans: RuntimeNetworkReservationPlan[] = await readMissingRuntimeNetworkReservationPlans(plans, config);
  const subnets: Ipv4Cidr[] = await allocateRuntimeNetworkSubnets(config.runtimeNetworkPool, missingPlans.length);
  missingPlans.forEach((plan: RuntimeNetworkReservationPlan, index: number): void => {
    plan.subnet = subnets[index];
  });

  return plans;
}

async function readMissingRuntimeNetworkReservationPlans(
  plans: RuntimeNetworkReservationPlan[],
  config: RuntimeNetworkCapacityConfig,
): Promise<RuntimeNetworkReservationPlan[]> {
  const missingPlans: RuntimeNetworkReservationPlan[] = [];
  for (const plan of plans) {
    const network: DockerInspectNetworkResult | null = await inspectDockerNetwork({
      networkName: plan.input.spec.networkName,
    });
    if (network !== null) {
      assertCompatibleExistingRuntimeNetwork(plan.input.spec, network, config);
      continue;
    }
    missingPlans.push(plan);
  }

  return missingPlans;
}
