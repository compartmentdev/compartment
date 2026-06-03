import { listDockerNetworks, type DockerListNetworkResult, type DockerNetworkIpamConfig } from '@compartment/docker';
import { cidrsOverlap, formatIpv4Cidr, parseIpv4Cidr, type Ipv4Cidr } from './runtime-network-cidr.service';
import { isManagedRuntimeNetwork } from './runtime-network-managed.service';
import { readHostRouteIpv4Cidrs } from './runtime-network-subnet-allocation.service';
import type { RuntimeNetworkCapacityConfig } from './runtime-network-capacity.types';

export async function assertRuntimeNetworkPoolDoesNotOverlapHostState(
  config: RuntimeNetworkCapacityConfig,
): Promise<void> {
  const pool: Ipv4Cidr = parseIpv4Cidr(config.runtimeNetworkPool.cidr);
  const networks: DockerListNetworkResult[] = await listDockerNetworks();
  const ownedRuntimeSubnets: Ipv4Cidr[] = readManagedRuntimeNetworkSubnets(networks, config);
  const conflictingDockerSubnet: Ipv4Cidr | undefined = findOverlappingCidr(
    pool,
    readForeignDockerNetworkSubnets(networks, config),
  );
  if (conflictingDockerSubnet !== undefined) {
    throw new Error(buildRuntimeNetworkPoolOverlapMessage(config, conflictingDockerSubnet, 'Docker network'));
  }

  const conflictingHostRoute: Ipv4Cidr | undefined = findOverlappingCidr(
    pool,
    (await readHostRouteIpv4Cidrs()).filter((route: Ipv4Cidr): boolean => !cidrEqualsAny(route, ownedRuntimeSubnets)),
  );
  if (conflictingHostRoute !== undefined) {
    throw new Error(buildRuntimeNetworkPoolOverlapMessage(config, conflictingHostRoute, 'host route'));
  }
}

function readManagedRuntimeNetworkSubnets(
  networks: DockerListNetworkResult[],
  config: RuntimeNetworkCapacityConfig,
): Ipv4Cidr[] {
  return networks
    .filter((network: DockerListNetworkResult): boolean => isManagedRuntimeNetwork(network, config.dockerNamespace))
    .flatMap(readDockerNetworkIpv4Cidrs);
}

function readForeignDockerNetworkSubnets(
  networks: DockerListNetworkResult[],
  config: RuntimeNetworkCapacityConfig,
): Ipv4Cidr[] {
  return networks
    .filter((network: DockerListNetworkResult): boolean => !isManagedRuntimeNetwork(network, config.dockerNamespace))
    .flatMap(readDockerNetworkIpv4Cidrs);
}

function readDockerNetworkIpv4Cidrs(network: DockerListNetworkResult): Ipv4Cidr[] {
  return (network.ipamConfigs ?? []).flatMap((ipam: DockerNetworkIpamConfig): Ipv4Cidr[] =>
    readIpv4CidrSafely(ipam.subnet),
  );
}

function readIpv4CidrSafely(value: string): Ipv4Cidr[] {
  try {
    return [parseIpv4Cidr(value)];
  } catch {
    return [];
  }
}

function findOverlappingCidr(pool: Ipv4Cidr, cidrs: Ipv4Cidr[]): Ipv4Cidr | undefined {
  return cidrs.find((cidr: Ipv4Cidr): boolean => cidrsOverlap(pool, cidr));
}

function cidrEqualsAny(cidr: Ipv4Cidr, candidates: Ipv4Cidr[]): boolean {
  return candidates.some((candidate: Ipv4Cidr): boolean => formatIpv4Cidr(candidate) === formatIpv4Cidr(cidr));
}

function buildRuntimeNetworkPoolOverlapMessage(
  config: RuntimeNetworkCapacityConfig,
  cidr: Ipv4Cidr,
  source: string,
): string {
  return `Runtime network pool ${config.runtimeNetworkPool.cidr} overlaps ${source} ${formatIpv4Cidr(cidr)}.`;
}
