import type Docker from 'dockerode';
import { createDockerClient } from './docker-client';
import { isDockerEngineConflictError, readDockerEngineErrorText, type DockerEngineError } from './docker-engine-error';
import { buildDockerLabelFilters } from './docker-label-filter';
import type {
  DockerConnectContainerToNetworkInput,
  DockerDisconnectContainerFromNetworkInput,
  DockerEnsureNetworkInput,
  DockerInspectNetworkInput,
  DockerInspectNetworkResult,
  DockerListContainerResult,
  DockerListContainersInput,
  DockerListNetworkResult,
  DockerNetworkIpamConfig,
  DockerRemoveNetworkInput,
} from './docker-models';

interface DockerNetworkInspectIpamConfig {
  Gateway?: string | undefined;
  Subnet?: string | undefined;
}

export async function ensureDockerNetwork(input: DockerEnsureNetworkInput): Promise<void> {
  assertDockerNetworkRequiredLabels(input);

  const docker: Docker = await createDockerClient();
  const network: Docker.Network = docker.getNetwork(input.networkName);
  const existingNetwork: Docker.NetworkInspectInfo | null = await inspectExistingDockerNetwork(network);
  if (existingNetwork !== null) {
    assertDockerNetworkCompatibility(input, existingNetwork);
    return;
  }

  const created: boolean = await createDockerNetwork(docker, input);
  if (created) {
    return;
  }

  await assertDockerNetworkAfterCreateConflict(network, input);
}

async function assertDockerNetworkAfterCreateConflict(
  network: Docker.Network,
  input: DockerEnsureNetworkInput,
): Promise<void> {
  const conflictedNetwork: Docker.NetworkInspectInfo | null = await inspectExistingDockerNetwork(network);
  if (conflictedNetwork === null) {
    throw new Error(`Docker network ${input.networkName} conflicted during creation but was not inspectable.`);
  }
  assertDockerNetworkCompatibility(input, conflictedNetwork);
}

async function inspectExistingDockerNetwork(network: Docker.Network): Promise<Docker.NetworkInspectInfo | null> {
  try {
    return await network.inspect();
  } catch (error) {
    if (!isDockerNetworkMissingError(error as DockerEngineError)) {
      throw error;
    }
    return null;
  }
}

async function createDockerNetwork(docker: Docker, input: DockerEnsureNetworkInput): Promise<boolean> {
  try {
    await docker.createNetwork({
      CheckDuplicate: true,
      ...(input.ipam !== undefined ? { IPAM: { Config: [{ Subnet: input.ipam.subnet }] } } : {}),
      Labels: input.labels,
      Name: input.networkName,
    });
    return true;
  } catch (error) {
    if (isDockerNetworkAlreadyExistsError(error as DockerEngineError)) {
      return false;
    }

    throw error;
  }
}

function assertDockerNetworkRequiredLabels(input: DockerEnsureNetworkInput): void {
  if (Object.keys(input.labels).length === 0) {
    throw new Error(`Docker network ${input.networkName} requires at least one ownership label.`);
  }
}

function assertDockerNetworkCompatibility(input: DockerEnsureNetworkInput, network: Docker.NetworkInspectInfo): void {
  assertDockerNetworkLabels(input.networkName, network.Labels ?? {}, input.labels);
  if (input.ipam !== undefined) {
    assertDockerNetworkIpam(input.networkName, network, input.ipam.subnet);
  }
}

function assertDockerNetworkLabels(
  networkName: string,
  existingLabels: Record<string, string>,
  requiredLabels: Record<string, string>,
): void {
  for (const [name, value] of Object.entries(requiredLabels)) {
    if (existingLabels[name] !== value) {
      throw new Error(`Docker network ${networkName} exists without required label ${name}=${value}.`);
    }
  }
}

function assertDockerNetworkIpam(
  networkName: string,
  network: Docker.NetworkInspectInfo,
  requiredSubnet: string,
): void {
  const subnets: Set<string> = new Set<string>(
    (network.IPAM?.Config ?? [])
      .map((config: DockerNetworkInspectIpamConfig): string | undefined => config.Subnet)
      .filter((subnet: string | undefined): subnet is string => subnet !== undefined),
  );
  if (subnets.has(requiredSubnet)) {
    return;
  }

  throw new Error(`Docker network ${networkName} exists without required IPAM subnet ${requiredSubnet}.`);
}

export async function connectDockerContainerToNetwork(input: DockerConnectContainerToNetworkInput): Promise<void> {
  const docker: Docker = await createDockerClient();

  try {
    await docker.getNetwork(input.networkName).connect({
      ...(input.aliases !== undefined ? { EndpointConfig: { Aliases: input.aliases } } : {}),
      Container: input.containerRef,
    });
  } catch (error) {
    if (isDockerContainerAlreadyConnectedError(error as DockerEngineError)) {
      return;
    }

    throw error;
  }
}

export async function disconnectDockerContainerFromNetwork(
  input: DockerDisconnectContainerFromNetworkInput,
): Promise<void> {
  const docker: Docker = await createDockerClient();

  try {
    await docker.getNetwork(input.networkName).disconnect({
      Container: input.containerRef,
      Force: true,
    });
  } catch (error) {
    if (
      isDockerContainerNotConnectedError(error as DockerEngineError) ||
      isDockerNetworkMissingError(error as DockerEngineError)
    ) {
      return;
    }

    throw error;
  }
}

export async function inspectDockerNetwork(
  input: DockerInspectNetworkInput,
): Promise<DockerInspectNetworkResult | null> {
  const docker: Docker = await createDockerClient();

  try {
    const network: Docker.NetworkInspectInfo = await docker.getNetwork(input.networkName).inspect();
    return {
      endpointContainerIds: Object.keys(network.Containers ?? {}),
      ipamConfigs: readDockerNetworkIpamConfigs(network),
      labels: network.Labels ?? {},
      name: network.Name,
    };
  } catch (error) {
    if (isDockerNetworkMissingError(error as DockerEngineError)) {
      return null;
    }

    throw error;
  }
}

export async function listDockerContainers(
  input: DockerListContainersInput = {},
): Promise<DockerListContainerResult[]> {
  const docker: Docker = await createDockerClient();
  const containers: Docker.ContainerInfo[] = await docker.listContainers({
    all: input.all ?? false,
    ...(input.labelFilters !== undefined ? { filters: { label: buildDockerLabelFilters(input.labelFilters) } } : {}),
  });

  return containers.map(
    (container: Docker.ContainerInfo): DockerListContainerResult => ({
      containerId: container.Id,
      isRunning: container.State === 'running',
      labels: container.Labels,
    }),
  );
}

export async function listDockerNetworks(): Promise<DockerListNetworkResult[]> {
  const docker: Docker = await createDockerClient();
  const networks: Docker.NetworkInspectInfo[] = await docker.listNetworks();

  return networks.map(
    (network: Docker.NetworkInspectInfo): DockerListNetworkResult => ({
      ipamConfigs: readDockerNetworkIpamConfigs(network),
      labels: network.Labels ?? {},
      name: network.Name,
    }),
  );
}

export async function removeDockerNetwork(input: DockerRemoveNetworkInput): Promise<void> {
  const docker: Docker = await createDockerClient();

  try {
    await docker.getNetwork(input.networkName).remove();
  } catch (error) {
    if (isDockerNetworkMissingError(error as DockerEngineError)) {
      return;
    }

    throw error;
  }
}

function readDockerNetworkIpamConfigs(network: Docker.NetworkInspectInfo): DockerNetworkIpamConfig[] {
  return (network.IPAM?.Config ?? []).flatMap((config: DockerNetworkInspectIpamConfig): DockerNetworkIpamConfig[] =>
    hasText(config.Subnet)
      ? [
          {
            gateway: hasText(config.Gateway) ? config.Gateway : null,
            subnet: config.Subnet,
          },
        ]
      : [],
  );
}

function hasText(value: string | null | undefined): value is string {
  return typeof value === 'string' && value !== '';
}

function isDockerNetworkMissingError(error: DockerEngineError): boolean {
  return readDockerEngineErrorText(error).includes('no such network');
}

function isDockerNetworkAlreadyExistsError(error: DockerEngineError): boolean {
  return isDockerEngineConflictError(error);
}

function isDockerContainerAlreadyConnectedError(error: DockerEngineError): boolean {
  const errorText: string = readDockerEngineErrorText(error);
  return errorText.includes('already exists in network') || errorText.includes('endpoint with name');
}

function isDockerContainerNotConnectedError(error: DockerEngineError): boolean {
  const errorText: string = readDockerEngineErrorText(error);
  return errorText.includes('is not connected to the network') || errorText.includes('not connected');
}
