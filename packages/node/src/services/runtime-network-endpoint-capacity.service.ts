import { inspectDockerNetwork, type DockerInspectNetworkResult } from '@compartment/docker';
import { createRuntimeNetworkIpCapacityExhaustedError } from '../errors/node-runtime-error';
import { formatIpv4Cidr, readIpv4CidrAddressCount, type Ipv4Cidr } from './runtime-network-cidr.service';
import {
  assertCompatibleExistingRuntimeNetwork,
  readCompatibleRuntimeNetworkSubnet,
} from './runtime-network-managed.service';
import type { RuntimeNetworkCapacityConfig, RuntimeNetworkSpec } from './runtime-network-capacity.types';

interface RuntimeNetworkEndpointCapacityInput {
  networkName: string;
  reason: string;
  reservedEndpointCount?: number | undefined;
  requiredFreeEndpoints: number;
  spec: RuntimeNetworkSpec;
}

interface RuntimeNetworkSubnetEndpointCapacityInput {
  networkName: string;
  reason: string;
  requiredEndpoints: number;
  subnet: Ipv4Cidr;
}

export async function assertRuntimeNetworkEndpointCapacity(
  input: RuntimeNetworkEndpointCapacityInput,
  config: RuntimeNetworkCapacityConfig,
): Promise<void> {
  if (input.requiredFreeEndpoints <= 0) {
    return;
  }

  const network: DockerInspectNetworkResult | null = await inspectDockerNetwork({ networkName: input.networkName });
  if (network === null) {
    throw new Error(`Docker runtime network ${input.networkName} does not exist.`);
  }

  assertCompatibleExistingRuntimeNetwork(input.spec, network, config);
  assertRuntimeNetworkEndpointCapacityForNetwork(input, network);
}

export function assertRuntimeNetworkSubnetEndpointCapacity(input: RuntimeNetworkSubnetEndpointCapacityInput): void {
  const usableEndpointCount: number = readUsableRuntimeNetworkEndpointCount(input.subnet);
  if (usableEndpointCount >= input.requiredEndpoints) {
    return;
  }

  throw createRuntimeNetworkIpCapacityExhaustedError(
    `Network ${input.networkName} would use subnet ${formatIpv4Cidr(input.subnet)} with ${usableEndpointCount.toString()} usable container IPs, but needs ${input.requiredEndpoints.toString()} for ${input.reason}. Use a larger runtime network subnet by lowering COMPARTMENT_RUNTIME_NETWORK_SUBNET_PREFIX.`,
  );
}

function assertRuntimeNetworkEndpointCapacityForNetwork(
  input: RuntimeNetworkEndpointCapacityInput,
  network: DockerInspectNetworkResult,
): void {
  const subnet: Ipv4Cidr = readCompatibleRuntimeNetworkSubnet(network);
  const usableEndpointCount: number = readUsableRuntimeNetworkEndpointCount(subnet);
  const usedEndpointCount: number = new Set<string>(network.endpointContainerIds).size;
  const reservedEndpointCount: number = input.reservedEndpointCount ?? 0;
  const freeEndpointCount: number = usableEndpointCount - usedEndpointCount - reservedEndpointCount;
  if (freeEndpointCount >= input.requiredFreeEndpoints) {
    return;
  }

  throw createRuntimeNetworkIpCapacityExhaustedError(
    `Network ${input.networkName} uses subnet ${formatIpv4Cidr(subnet)} with ${usableEndpointCount.toString()} usable container IPs, ${usedEndpointCount.toString()} attached endpoints, and ${reservedEndpointCount.toString()} reserved endpoints; it needs ${input.requiredFreeEndpoints.toString()} more for ${input.reason}. Use a larger runtime network subnet by lowering COMPARTMENT_RUNTIME_NETWORK_SUBNET_PREFIX.`,
  );
}

function readUsableRuntimeNetworkEndpointCount(subnet: Ipv4Cidr): number {
  return Math.max(0, readIpv4CidrAddressCount(subnet) - 3);
}
