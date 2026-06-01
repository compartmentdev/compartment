import {
  compartmentDockerNamespaceLabelName,
  inspectDockerNetwork,
  type DockerInspectNetworkResult,
} from '@compartment/docker';
import type { RuntimeNetworkCapacityConfig, RuntimeNetworkSpec } from './runtime-network-capacity.types';
import { ensureInspectedRuntimeNetworkManaged } from './runtime-network-create.service';
import { isRuntimeNetworkName } from './runtime-names.service';

export async function assertExistingDesiredRuntimeNetwork(
  config: RuntimeNetworkCapacityConfig,
  networkName: string,
  desiredNetworkSpecs: Map<string, RuntimeNetworkSpec>,
): Promise<void> {
  const network: DockerInspectNetworkResult | null = await inspectDockerNetwork({ networkName });
  if (network === null) {
    throw new Error(`Docker runtime network ${networkName} is missing.`);
  }

  await ensureInspectedRuntimeNetworkManaged(
    readDesiredRuntimeNetworkSpec(networkName, desiredNetworkSpecs),
    network,
    config,
  );
}

export async function isCurrentRuntimeNetworkAttachment(
  networkName: string,
  desiredNetworkNames: Set<string>,
  desiredNetworkSpecs: Map<string, RuntimeNetworkSpec>,
  config: RuntimeNetworkCapacityConfig,
): Promise<boolean> {
  if (!isRuntimeNetworkName(networkName, config.dockerNamespace)) {
    return false;
  }

  const network: DockerInspectNetworkResult | null = await inspectDockerNetwork({ networkName });
  if (network === null) {
    return false;
  }

  const desiredSpec: RuntimeNetworkSpec | undefined = desiredNetworkSpecs.get(networkName);
  if (desiredSpec !== undefined) {
    await ensureInspectedRuntimeNetworkManaged(desiredSpec, network, config);
    return true;
  }

  assertDesiredNetworkHasSpec(networkName, desiredNetworkNames);
  return isOwnedRuntimeNetwork(network, config);
}

export function isOwnedRuntimeNetwork(
  network: Pick<DockerInspectNetworkResult, 'labels' | 'name'>,
  config: Pick<RuntimeNetworkCapacityConfig, 'dockerNamespace'>,
): boolean {
  return (
    isRuntimeNetworkName(network.name, config.dockerNamespace) &&
    network.labels[compartmentDockerNamespaceLabelName] === config.dockerNamespace
  );
}

function readDesiredRuntimeNetworkSpec(
  networkName: string,
  desiredNetworkSpecs: Map<string, RuntimeNetworkSpec>,
): RuntimeNetworkSpec {
  const spec: RuntimeNetworkSpec | undefined = desiredNetworkSpecs.get(networkName);
  if (spec === undefined) {
    throw new Error(`Docker runtime network ${networkName} is desired but has no runtime network specification.`);
  }

  return spec;
}

function assertDesiredNetworkHasSpec(networkName: string, desiredNetworkNames: Set<string>): void {
  if (desiredNetworkNames.has(networkName)) {
    throw new Error(`Docker runtime network ${networkName} is desired but has no runtime network specification.`);
  }
}
