import { execFile } from 'node:child_process';
import { listDockerNetworks, type DockerListNetworkResult, type DockerNetworkIpamConfig } from '@compartment/docker';
import { createRuntimeNetworkCapacityExhaustedError } from '../errors/node-runtime-error';
import {
  cidrsOverlap,
  enumerateIpv4Subnets,
  parseIpv4Cidr,
  parseIpv4RouteCidrs,
  type Ipv4Cidr,
} from './runtime-network-cidr.service';
import type { RuntimeNetworkPoolConfig } from './runtime.types';

type ExecFileCallback = (error: Error | null, stdout: string | Buffer, stderr: string | Buffer) => void;

export async function allocateRuntimeNetworkSubnet(poolConfig: RuntimeNetworkPoolConfig): Promise<Ipv4Cidr> {
  const [subnet]: Ipv4Cidr[] = await allocateRuntimeNetworkSubnets(poolConfig, 1);
  if (subnet === undefined) {
    throw createRuntimeNetworkCapacityExhaustedError(
      `Docker runtime network pool ${poolConfig.cidr} has no available /${poolConfig.subnetPrefixLength.toString()} subnets.`,
    );
  }

  return subnet;
}

export async function allocateRuntimeNetworkSubnetIgnoring(
  poolConfig: RuntimeNetworkPoolConfig,
  ignoredCidrs: readonly Ipv4Cidr[],
): Promise<Ipv4Cidr> {
  const [subnet]: Ipv4Cidr[] = await allocateRuntimeNetworkSubnets(poolConfig, 1, ignoredCidrs);
  if (subnet === undefined) {
    throw createRuntimeNetworkCapacityExhaustedError(
      `Docker runtime network pool ${poolConfig.cidr} has no available /${poolConfig.subnetPrefixLength.toString()} subnets.`,
    );
  }

  return subnet;
}

export async function allocateRuntimeNetworkSubnetAvoiding(
  poolConfig: RuntimeNetworkPoolConfig,
  avoidedCidrs: readonly Ipv4Cidr[],
): Promise<Ipv4Cidr> {
  const [subnet]: Ipv4Cidr[] = await allocateRuntimeNetworkSubnets(poolConfig, 1, [], avoidedCidrs);
  if (subnet === undefined) {
    throw createRuntimeNetworkCapacityExhaustedError(
      `Docker runtime network pool ${poolConfig.cidr} has no available /${poolConfig.subnetPrefixLength.toString()} subnets.`,
    );
  }

  return subnet;
}

export async function allocateRuntimeNetworkSubnets(
  poolConfig: RuntimeNetworkPoolConfig,
  count: number,
  ignoredCidrs: readonly Ipv4Cidr[] = [],
  avoidedCidrs: readonly Ipv4Cidr[] = [],
): Promise<Ipv4Cidr[]> {
  assertRuntimeNetworkSubnetAllocationCount(count);
  if (count === 0) {
    return [];
  }

  const pool: Ipv4Cidr = parseIpv4Cidr(poolConfig.cidr);
  const occupiedCidrs: Ipv4Cidr[] = removeIgnoredCidrs(await readOccupiedIpv4Cidrs(), ignoredCidrs);
  const unavailableCidrs: Ipv4Cidr[] = [...occupiedCidrs, ...avoidedCidrs];
  const selectedCidrs: Ipv4Cidr[] = selectAvailableRuntimeNetworkSubnets(pool, poolConfig, count, unavailableCidrs);
  if (selectedCidrs.length === count) {
    return selectedCidrs;
  }

  throw createRuntimeNetworkCapacityExhaustedError(
    `Docker runtime network pool ${poolConfig.cidr} has no available /${poolConfig.subnetPrefixLength.toString()} subnets.`,
  );
}

function assertRuntimeNetworkSubnetAllocationCount(count: number): void {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError('Runtime network subnet allocation count must be a non-negative integer.');
  }
}

function selectAvailableRuntimeNetworkSubnets(
  pool: Ipv4Cidr,
  poolConfig: RuntimeNetworkPoolConfig,
  count: number,
  unavailableCidrs: readonly Ipv4Cidr[],
): Ipv4Cidr[] {
  const selectedCidrs: Ipv4Cidr[] = [];
  for (const candidate of enumerateIpv4Subnets(pool, poolConfig.subnetPrefixLength)) {
    addAvailableRuntimeNetworkSubnet(candidate, unavailableCidrs, selectedCidrs);
    if (selectedCidrs.length === count) {
      break;
    }
  }
  return selectedCidrs;
}

function addAvailableRuntimeNetworkSubnet(
  candidate: Ipv4Cidr,
  unavailableCidrs: readonly Ipv4Cidr[],
  selectedCidrs: Ipv4Cidr[],
): void {
  if (!cidrOverlapsAny(candidate, unavailableCidrs) && !cidrOverlapsAny(candidate, selectedCidrs)) {
    selectedCidrs.push(candidate);
  }
}

async function readOccupiedIpv4Cidrs(): Promise<Ipv4Cidr[]> {
  const dockerCidrs: Ipv4Cidr[] = readDockerNetworkIpv4Cidrs(await listDockerNetworks());
  const hostCidrs: Ipv4Cidr[] = await readHostRouteIpv4Cidrs();

  return [...dockerCidrs, ...hostCidrs];
}

function readDockerNetworkIpv4Cidrs(networks: DockerListNetworkResult[]): Ipv4Cidr[] {
  return networks.flatMap((network: DockerListNetworkResult): Ipv4Cidr[] =>
    (network.ipamConfigs ?? []).flatMap((config: DockerNetworkIpamConfig): Ipv4Cidr[] =>
      readIpv4CidrSafely(config.subnet),
    ),
  );
}

export async function readHostRouteIpv4Cidrs(): Promise<Ipv4Cidr[]> {
  try {
    return parseIpv4RouteCidrs(await execFileStdout('ip', ['-4', 'route', 'show']));
  } catch (error) {
    const message: string = error instanceof Error ? error.message : 'Unknown host route inspection error.';
    throw createRuntimeNetworkCapacityExhaustedError(
      `Unable to inspect host IPv4 routes before allocating a runtime network subnet: ${message}`,
    );
  }
}

async function execFileStdout(file: string, args: string[]): Promise<string> {
  return await new Promise<string>((resolve: (stdout: string) => void, reject: (error: Error) => void): void => {
    const callback: ExecFileCallback = (error: Error | null, stdout: string | Buffer): void => {
      if (error !== null) {
        reject(error);
        return;
      }
      resolve(stdout.toString());
    };
    execFile(file, args, callback);
  });
}

function readIpv4CidrSafely(value: string): Ipv4Cidr[] {
  try {
    return [parseIpv4Cidr(value)];
  } catch {
    return [];
  }
}

function cidrOverlapsAny(candidate: Ipv4Cidr, occupiedCidrs: readonly Ipv4Cidr[]): boolean {
  return occupiedCidrs.some((occupied: Ipv4Cidr): boolean => cidrsOverlap(candidate, occupied));
}

function removeIgnoredCidrs(occupiedCidrs: Ipv4Cidr[], ignoredCidrs: readonly Ipv4Cidr[]): Ipv4Cidr[] {
  return occupiedCidrs.filter((cidr: Ipv4Cidr): boolean => !cidrEqualsAny(cidr, ignoredCidrs));
}

function cidrEqualsAny(cidr: Ipv4Cidr, candidates: readonly Ipv4Cidr[]): boolean {
  return candidates.some((candidate: Ipv4Cidr): boolean => cidrEquals(cidr, candidate));
}

function cidrEquals(left: Ipv4Cidr, right: Ipv4Cidr): boolean {
  return left.address === right.address && left.prefixLength === right.prefixLength;
}
