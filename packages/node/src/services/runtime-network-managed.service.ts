import {
  buildDockerNamespaceLabels,
  compartmentDockerNamespaceLabelName,
  type DockerInspectNetworkResult,
  type DockerNetworkIpamConfig,
} from '@compartment/docker';
import { environmentIdLabelName, projectIdLabelName, serviceIdLabelName } from './runtime-container-labels';
import { cidrContainsCidr, formatIpv4Cidr, parseIpv4Cidr, type Ipv4Cidr } from './runtime-network-cidr.service';
import { isRuntimeNetworkName } from './runtime-names.service';
import type {
  RuntimeNetworkCapacityConfig,
  RuntimeNetworkCreateInput,
  RuntimeNetworkSpec,
} from './runtime-network-capacity.types';

const runtimeNetworkKindLabelName: string = 'compartment.network.kind';
const runtimeNetworkManagedIpamLabelName: string = 'compartment.network.ipam';
const runtimeNetworkPoolCidrLabelName: string = 'compartment.network.poolCidr';
const runtimeNetworkReservationExpiresAtLabelName: string = 'compartment.network.reservationExpiresAt';
export const runtimeNetworkReservationIdLabelName: string = 'compartment.network.reservationId';
const runtimeNetworkSubnetLabelName: string = 'compartment.network.subnet';
const runtimeNetworkSubnetPrefixLabelName: string = 'compartment.network.subnetPrefix';

const runtimeNetworkManagedIpamLabelValue: string = 'managed';

export function buildRuntimeNetworkLabels(
  input: RuntimeNetworkCreateInput,
  config: RuntimeNetworkCapacityConfig,
  subnet: Ipv4Cidr,
): Record<string, string> {
  return {
    ...buildDockerNamespaceLabels(config.dockerNamespace),
    [environmentIdLabelName]: input.spec.environmentId,
    [projectIdLabelName]: input.spec.projectId,
    ...(input.spec.serviceId !== undefined ? { [serviceIdLabelName]: input.spec.serviceId } : {}),
    [runtimeNetworkKindLabelName]: input.spec.kind,
    [runtimeNetworkManagedIpamLabelName]: runtimeNetworkManagedIpamLabelValue,
    [runtimeNetworkPoolCidrLabelName]: config.runtimeNetworkPool.cidr,
    ...(input.reservationExpiresAt !== undefined
      ? { [runtimeNetworkReservationExpiresAtLabelName]: input.reservationExpiresAt }
      : {}),
    ...(input.reservationId !== undefined ? { [runtimeNetworkReservationIdLabelName]: input.reservationId } : {}),
    [runtimeNetworkSubnetLabelName]: formatIpv4Cidr(subnet),
    [runtimeNetworkSubnetPrefixLabelName]: config.runtimeNetworkPool.subnetPrefixLength.toString(),
  };
}

export function assertCompatibleExistingRuntimeNetwork(
  spec: RuntimeNetworkSpec,
  network: DockerInspectNetworkResult,
  config: RuntimeNetworkCapacityConfig,
): void {
  if (!isManagedRuntimeNetwork(network, config.dockerNamespace)) {
    throw new Error(
      `Docker runtime network ${spec.networkName} exists without required managed Compartment network labels.`,
    );
  }

  assertManagedRuntimeNetwork(network, { dockerNamespace: config.dockerNamespace, networkName: spec.networkName });
  assertRuntimeNetworkSpecLabels(network, spec);
  assertRuntimeNetworkLabel(network, spec.networkName, runtimeNetworkPoolCidrLabelName, config.runtimeNetworkPool.cidr);
  assertRuntimeNetworkLabel(
    network,
    spec.networkName,
    runtimeNetworkSubnetPrefixLabelName,
    config.runtimeNetworkPool.subnetPrefixLength.toString(),
  );
  assertRuntimeNetworkSubnet(network, config);
}

function assertRuntimeNetworkSpecLabels(network: DockerInspectNetworkResult, spec: RuntimeNetworkSpec): void {
  assertRuntimeNetworkLabel(network, spec.networkName, runtimeNetworkKindLabelName, spec.kind);
  assertRuntimeNetworkLabel(network, spec.networkName, projectIdLabelName, spec.projectId);
  assertRuntimeNetworkLabel(network, spec.networkName, environmentIdLabelName, spec.environmentId);
  if (spec.serviceId !== undefined) {
    assertRuntimeNetworkLabel(network, spec.networkName, serviceIdLabelName, spec.serviceId);
  }
}

export function readCompatibleRuntimeNetworkSubnet(network: DockerInspectNetworkResult): Ipv4Cidr {
  const subnetLabel: string | undefined = network.labels[runtimeNetworkSubnetLabelName];
  if (subnetLabel !== undefined) {
    return parseIpv4Cidr(subnetLabel);
  }

  return readRuntimeNetworkDockerIpamSubnet(network);
}

export function isRuntimeNetworkReservationActive(network: Pick<DockerInspectNetworkResult, 'labels'>): boolean {
  const expiresAt: string | undefined = network.labels[runtimeNetworkReservationExpiresAtLabelName];
  return expiresAt !== undefined && Date.parse(expiresAt) > Date.now();
}

function assertManagedRuntimeNetwork(
  network: DockerInspectNetworkResult,
  input: { dockerNamespace: string; networkName: string },
): void {
  if (!isManagedRuntimeNetwork(network, input.dockerNamespace)) {
    throw new Error(
      `Docker runtime network ${input.networkName} exists without required managed Compartment network labels.`,
    );
  }

  assertRuntimeNetworkHasDockerIpam(network, input.networkName);
}

export function isManagedRuntimeNetwork(
  network: Pick<DockerInspectNetworkResult, 'labels' | 'name'>,
  dockerNamespace: string,
): boolean {
  return (
    isRuntimeNetworkName(network.name, dockerNamespace) &&
    network.labels[compartmentDockerNamespaceLabelName] === dockerNamespace &&
    network.labels[runtimeNetworkManagedIpamLabelName] === runtimeNetworkManagedIpamLabelValue
  );
}

function assertRuntimeNetworkLabel(
  network: DockerInspectNetworkResult,
  networkName: string,
  labelName: string,
  expectedValue: string,
): void {
  if (network.labels[labelName] === expectedValue) {
    return;
  }

  throw new Error(`Docker runtime network ${networkName} exists without required label ${labelName}=${expectedValue}.`);
}

function assertRuntimeNetworkSubnet(network: DockerInspectNetworkResult, config: RuntimeNetworkCapacityConfig): void {
  const subnetLabel: string | undefined = network.labels[runtimeNetworkSubnetLabelName];
  const subnet: Ipv4Cidr | undefined = subnetLabel === undefined ? undefined : parseIpv4Cidr(subnetLabel);
  const pool: Ipv4Cidr = parseIpv4Cidr(config.runtimeNetworkPool.cidr);
  if (
    subnet?.prefixLength === config.runtimeNetworkPool.subnetPrefixLength &&
    cidrContainsCidr(pool, subnet) &&
    hasDockerIpamSubnet(network, subnet)
  ) {
    return;
  }

  throw new Error(`Docker runtime network ${network.name} exists without a managed subnet from the runtime pool.`);
}

function readRuntimeNetworkDockerIpamSubnet(network: DockerInspectNetworkResult): Ipv4Cidr {
  const ipamSubnet: string | undefined = network.ipamConfigs.find(
    (config: DockerNetworkIpamConfig): boolean => config.subnet !== '',
  )?.subnet;
  if (ipamSubnet !== undefined) {
    return parseIpv4Cidr(ipamSubnet);
  }

  throw new Error(`Docker runtime network ${network.name} exists without required Docker IPAM subnet.`);
}

function assertRuntimeNetworkHasDockerIpam(network: DockerInspectNetworkResult, networkName: string): void {
  if (network.ipamConfigs.some((config: DockerNetworkIpamConfig): boolean => config.subnet !== '')) {
    return;
  }

  throw new Error(`Docker runtime network ${networkName} exists without required managed Docker IPAM subnet.`);
}

function hasDockerIpamSubnet(network: DockerInspectNetworkResult, subnet: Ipv4Cidr): boolean {
  const formattedSubnet: string = formatIpv4Cidr(subnet);
  return network.ipamConfigs.some((config: DockerNetworkIpamConfig): boolean => config.subnet === formattedSubnet);
}
