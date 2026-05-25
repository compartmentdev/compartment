import { isIP } from 'node:net';
import {
  inspectDockerContainer,
  inspectDockerNetwork,
  syncDockerNetworkEgressDenyRules,
  type DockerInspectContainerResult,
  type DockerInspectNetworkResult,
  type DockerNetworkIpamConfig,
  type DockerNetworkAttachment,
} from '@compartment/docker';
import { buildDbNetworkName, buildSystemNetworkName } from './runtime-names.service';
import { readDesiredRuntimeNetworkNames, type DesiredRuntimeNetworkNames } from './runtime-network-desired.service';

const linkLocalPrefix: string = ['169', '254'].join('.');
const instanceMetadataCidr: string = `${linkLocalPrefix}.169.254/32`;
const linkLocalCidr: string = `${linkLocalPrefix}.0.0/16`;

interface RuntimeNetworkEgressDenyConfig {
  dockerNamespace: string;
}

interface RuntimeNetworkEgressDenyOptions {
  readonly platformSourceContainerRefs?: readonly string[] | undefined;
}

interface RuntimeNetworkEgressDenyInput extends RuntimeNetworkEgressDenyConfig, RuntimeNetworkEgressDenyOptions {
  readonly networkNames: Iterable<string>;
}

export async function syncCurrentRuntimeNetworkEgressDenyRules(
  config: RuntimeNetworkEgressDenyConfig,
  additionalNetworkNames: Iterable<string>,
  options: RuntimeNetworkEgressDenyOptions = {},
): Promise<void> {
  const desiredNetworkNames: DesiredRuntimeNetworkNames = await readDesiredRuntimeNetworkNames(config);
  await syncDesiredRuntimeNetworkEgressDenyRules(config, desiredNetworkNames, additionalNetworkNames, options);
}

export async function syncDesiredRuntimeNetworkEgressDenyRules(
  config: RuntimeNetworkEgressDenyConfig,
  desiredNetworkNames: DesiredRuntimeNetworkNames,
  additionalNetworkNames: Iterable<string> = [],
  options: RuntimeNetworkEgressDenyOptions = {},
): Promise<void> {
  await syncRuntimeNetworkEgressDenyRules({
    dockerNamespace: config.dockerNamespace,
    networkNames: buildRuntimeNetworkEgressDenyNetworkNames(desiredNetworkNames, additionalNetworkNames),
    platformSourceContainerRefs: options.platformSourceContainerRefs,
  });
}

export async function syncRuntimeNetworkEgressDenyRules(input: RuntimeNetworkEgressDenyInput): Promise<void> {
  const sourceNetworks: DockerInspectNetworkResult[] = await inspectRequiredRuntimeNetworks(input.networkNames);
  if (sourceNetworks.length === 0) {
    await syncDockerNetworkEgressDenyRules({
      destinationCidrs: [],
      namespace: input.dockerNamespace,
      sourceAllowCidrs: [],
      sourceSubnets: [],
    });
    return;
  }

  const sourceNetworkNames: Set<string> = new Set<string>(
    sourceNetworks.map((network: DockerInspectNetworkResult): string => network.name),
  );
  await syncDockerNetworkEgressDenyRules({
    destinationCidrs: await readRuntimeNetworkDeniedDestinationCidrs(input, sourceNetworks),
    namespace: input.dockerNamespace,
    sourceAllowCidrs: await readRuntimeNetworkSourceAllowCidrs(
      input.platformSourceContainerRefs ?? [],
      sourceNetworkNames,
    ),
    sourceSubnets: readRuntimeNetworkSourceSubnets(sourceNetworks),
  });
}

async function inspectRequiredRuntimeNetworks(networkNames: Iterable<string>): Promise<DockerInspectNetworkResult[]> {
  const networks: DockerInspectNetworkResult[] = [];
  for (const networkName of new Set(networkNames)) {
    const network: DockerInspectNetworkResult | null = await inspectDockerNetwork({ networkName });
    if (network === null) {
      throw new Error(`Expected Docker runtime network ${networkName} before egress deny sync.`);
    }

    networks.push(network);
  }

  return networks;
}

async function readRuntimeNetworkDeniedDestinationCidrs(
  config: RuntimeNetworkEgressDenyConfig,
  sourceNetworks: readonly DockerInspectNetworkResult[],
): Promise<string[]> {
  const internalNetworkSubnets: string[] = await readInternalNetworkSubnets(config);
  return dedupeCidrs([
    instanceMetadataCidr,
    linkLocalCidr,
    ...readRuntimeNetworkGatewayCidrs(sourceNetworks),
    ...internalNetworkSubnets,
  ]);
}

function readRuntimeNetworkSourceSubnets(networks: readonly DockerInspectNetworkResult[]): string[] {
  return dedupeCidrs(
    networks.flatMap((network: DockerInspectNetworkResult): string[] =>
      network.ipamConfigs.map((config: DockerNetworkIpamConfig): string => config.subnet),
    ),
  );
}

async function readRuntimeNetworkSourceAllowCidrs(
  containerRefs: readonly string[],
  sourceNetworkNames: ReadonlySet<string>,
): Promise<string[]> {
  const cidrs: string[] = [];
  for (const containerRef of new Set(containerRefs)) {
    const container: DockerInspectContainerResult | null = await inspectDockerContainer({ containerRef });
    if (container?.networkAttachments === undefined) {
      throw new Error(`Expected docker network attachments for container ${containerRef}.`);
    }

    cidrs.push(...readContainerSourceAllowCidrs(container.networkAttachments, sourceNetworkNames));
  }

  return dedupeCidrs(cidrs);
}

function readContainerSourceAllowCidrs(
  attachments: readonly DockerNetworkAttachment[],
  sourceNetworkNames: ReadonlySet<string>,
): string[] {
  return attachments.flatMap((attachment: DockerNetworkAttachment): string[] => {
    const ipAddress: string | null = attachment.ipAddress;
    if (!sourceNetworkNames.has(attachment.name) || ipAddress === null || isIP(ipAddress) !== 4) {
      return [];
    }

    return [`${ipAddress}/32`];
  });
}

function readRuntimeNetworkGatewayCidrs(networks: readonly DockerInspectNetworkResult[]): string[] {
  return networks.flatMap((network: DockerInspectNetworkResult): string[] =>
    network.ipamConfigs.flatMap((config: DockerNetworkIpamConfig): string[] => {
      if (config.gateway === null || isIP(config.gateway) !== 4) {
        return [];
      }

      return [`${config.gateway}/32`];
    }),
  );
}

async function readInternalNetworkSubnets(config: RuntimeNetworkEgressDenyConfig): Promise<string[]> {
  const networkNames: string[] = [
    buildSystemNetworkName(config.dockerNamespace),
    buildDbNetworkName(config.dockerNamespace),
  ];
  const subnets: string[] = [];
  for (const networkName of networkNames) {
    const network: DockerInspectNetworkResult | null = await inspectDockerNetwork({ networkName });
    if (network === null) {
      continue;
    }

    subnets.push(...network.ipamConfigs.map((ipamConfig: DockerNetworkIpamConfig): string => ipamConfig.subnet));
  }

  return subnets;
}

function dedupeCidrs(cidrs: readonly string[]): string[] {
  return [...new Set(cidrs.filter(isIpv4Cidr))].sort((left: string, right: string): number =>
    left.localeCompare(right),
  );
}

function isIpv4Cidr(value: string): boolean {
  const parts: string[] = value.split('/');
  const address: string | undefined = parts[0];
  const prefixLengthText: string | undefined = parts[1];
  if (parts.length !== 2 || address === undefined || prefixLengthText === undefined || isIP(address) !== 4) {
    return false;
  }

  const prefixLength: number = Number.parseInt(prefixLengthText, 10);
  return prefixLength.toString() === prefixLengthText && prefixLength >= 0 && prefixLength <= 32;
}

function buildRuntimeNetworkEgressDenyNetworkNames(
  desiredNetworkNames: DesiredRuntimeNetworkNames,
  additionalNetworkNames: Iterable<string>,
): Set<string> {
  return new Set<string>([
    ...desiredNetworkNames.serviceNetworkNames,
    ...desiredNetworkNames.resourceNetworkNames,
    ...additionalNetworkNames,
  ]);
}
