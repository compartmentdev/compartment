import { inspectDockerNetwork, type DockerInspectNetworkResult } from '@compartment/docker';
import { assertCompatibleExistingRuntimeNetwork, isLegacyRuntimeNetwork } from './runtime-network-managed.service';
import { readRuntimeNetworkIpamCidrs } from './runtime-network-migration.service';
import { allocateRuntimeNetworkSubnets } from './runtime-network-subnet-allocation.service';
import type {
  RuntimeNetworkCapacityConfig,
  RuntimeNetworkCreateInput,
  RuntimeNetworkSpec,
} from './runtime-network-capacity.types';
import type { Ipv4Cidr } from './runtime-network-cidr.service';

export interface RuntimeNetworkReservationPlan {
  existingLegacyNetwork?: DockerInspectNetworkResult | undefined;
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
  const subnets: Ipv4Cidr[] = await allocateRuntimeNetworkSubnets(
    config.runtimeNetworkPool,
    missingPlans.length,
    readLegacyRuntimeNetworkIpamCidrs(missingPlans),
  );
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
      if (isLegacyRuntimeNetwork(network, config.dockerNamespace)) {
        plan.existingLegacyNetwork = network;
        missingPlans.push(plan);
        continue;
      }
      assertCompatibleExistingRuntimeNetwork(plan.input.spec, network, config);
      continue;
    }
    missingPlans.push(plan);
  }

  return missingPlans;
}

function readLegacyRuntimeNetworkIpamCidrs(plans: RuntimeNetworkReservationPlan[]): Ipv4Cidr[] {
  return plans.flatMap((plan: RuntimeNetworkReservationPlan): Ipv4Cidr[] =>
    plan.existingLegacyNetwork === undefined ? [] : readRuntimeNetworkIpamCidrs(plan.existingLegacyNetwork),
  );
}
