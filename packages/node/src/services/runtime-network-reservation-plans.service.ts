import { inspectDockerNetwork, type DockerInspectNetworkResult } from '@compartment/docker';
import { assertCompatibleExistingRuntimeNetwork } from './runtime-network-managed.service';
import { allocateRuntimeNetworkSubnets } from './runtime-network-subnet-allocation.service';
import type {
  RuntimeNetworkCapacityConfig,
  RuntimeNetworkCreateInput,
  RuntimeNetworkSpec,
} from './runtime-network-capacity.types';
import type { Ipv4Cidr } from './runtime-network-cidr.service';

export interface RuntimeNetworkCreateReservationPlan {
  input: RuntimeNetworkCreateInput;
  kind: 'create';
  subnet: Ipv4Cidr;
}

export interface RuntimeNetworkExistingReservationPlan {
  input: RuntimeNetworkCreateInput;
  kind: 'existing';
}

export type RuntimeNetworkReservationPlan = RuntimeNetworkCreateReservationPlan | RuntimeNetworkExistingReservationPlan;

interface RuntimeNetworkReservationPlanDraft {
  input: RuntimeNetworkCreateInput;
  requiresCreate: boolean;
}

export async function buildRuntimeNetworkReservationPlans(
  specs: RuntimeNetworkSpec[],
  reservation: Pick<RuntimeNetworkCreateInput, 'reservationExpiresAt' | 'reservationId'>,
  config: RuntimeNetworkCapacityConfig,
): Promise<RuntimeNetworkReservationPlan[]> {
  const planDrafts: RuntimeNetworkReservationPlanDraft[] = specs.map(
    (spec: RuntimeNetworkSpec): RuntimeNetworkReservationPlanDraft => ({
      input: {
        ...reservation,
        spec,
      },
      requiresCreate: false,
    }),
  );
  const inspectedPlanDrafts: RuntimeNetworkReservationPlanDraft[] =
    await readInspectedRuntimeNetworkReservationPlanDrafts(planDrafts, config);
  const createPlanDrafts: RuntimeNetworkReservationPlanDraft[] = inspectedPlanDrafts.filter(
    (plan: RuntimeNetworkReservationPlanDraft): boolean => plan.requiresCreate,
  );
  const subnets: Ipv4Cidr[] = await allocateRuntimeNetworkSubnets(config.runtimeNetworkPool, createPlanDrafts.length);

  return buildRuntimeNetworkReservationPlansWithSubnets(inspectedPlanDrafts, subnets);
}

async function readInspectedRuntimeNetworkReservationPlanDrafts(
  plans: RuntimeNetworkReservationPlanDraft[],
  config: RuntimeNetworkCapacityConfig,
): Promise<RuntimeNetworkReservationPlanDraft[]> {
  const inspectedPlans: RuntimeNetworkReservationPlanDraft[] = [];
  for (const plan of plans) {
    const network: DockerInspectNetworkResult | null = await inspectDockerNetwork({
      networkName: plan.input.spec.networkName,
    });
    if (network !== null) {
      assertCompatibleExistingRuntimeNetwork(plan.input.spec, network, config);
      inspectedPlans.push(plan);
      continue;
    }
    inspectedPlans.push({
      ...plan,
      requiresCreate: true,
    });
  }

  return inspectedPlans;
}

function buildRuntimeNetworkReservationPlansWithSubnets(
  planDrafts: RuntimeNetworkReservationPlanDraft[],
  subnets: Ipv4Cidr[],
): RuntimeNetworkReservationPlan[] {
  let createPlanIndex: number = 0;
  return planDrafts.map((plan: RuntimeNetworkReservationPlanDraft): RuntimeNetworkReservationPlan => {
    if (!plan.requiresCreate) {
      return {
        input: plan.input,
        kind: 'existing',
      };
    }

    const subnet: Ipv4Cidr | undefined = subnets[createPlanIndex];
    if (subnet === undefined) {
      throw new Error(`Expected allocated subnet for Docker runtime network ${plan.input.spec.networkName}.`);
    }
    createPlanIndex += 1;

    return {
      input: plan.input,
      kind: 'create',
      subnet,
    };
  });
}
