import {
  buildDockerNamespaceLabels,
  compartmentDockerNamespaceLabelName,
  ensureDockerNetwork,
  inspectDockerNetwork,
  type DockerInspectNetworkResult,
} from '@compartment/docker';

interface RuntimeNetworkOwnershipInput {
  dockerNamespace: string;
  networkName: string;
}

type RuntimeNetworkOwnershipLabels = Pick<DockerInspectNetworkResult, 'labels' | 'name'>;

export async function ensureCompatibleRuntimeNetwork(input: RuntimeNetworkOwnershipInput): Promise<void> {
  const network: DockerInspectNetworkResult | null = await inspectDockerNetwork({ networkName: input.networkName });
  if (network === null) {
    await ensureOwnedRuntimeNetwork(input);
    return;
  }

  assertCompatibleRuntimeNetwork(input, network);
}

export async function ensureOwnedRuntimeNetwork(input: RuntimeNetworkOwnershipInput): Promise<void> {
  await ensureDockerNetwork({
    labels: buildDockerNamespaceLabels(input.dockerNamespace),
    networkName: input.networkName,
  });
}

export async function assertExistingOwnedRuntimeNetwork(input: RuntimeNetworkOwnershipInput): Promise<void> {
  const network: DockerInspectNetworkResult | null = await inspectDockerNetwork({ networkName: input.networkName });
  if (network === null) {
    throw new Error(`Docker runtime network ${input.networkName} is missing.`);
  }

  if (network.labels[compartmentDockerNamespaceLabelName] !== input.dockerNamespace) {
    throw new Error(
      `Docker runtime network ${input.networkName} exists without required label ` +
        `${compartmentDockerNamespaceLabelName}=${input.dockerNamespace}.`,
    );
  }
}

export function assertCompatibleRuntimeNetwork(
  input: RuntimeNetworkOwnershipInput,
  network: RuntimeNetworkOwnershipLabels,
): void {
  if (isCompatibleRuntimeNetwork(input, network)) {
    return;
  }

  throw new Error(
    `Docker runtime network ${input.networkName} exists without required label ` +
      `${compartmentDockerNamespaceLabelName}=${input.dockerNamespace}.`,
  );
}

export function isCompatibleRuntimeNetwork(
  input: RuntimeNetworkOwnershipInput,
  network: RuntimeNetworkOwnershipLabels,
): boolean {
  const dockerNamespace: string | undefined = network.labels[compartmentDockerNamespaceLabelName];
  return dockerNamespace === undefined || dockerNamespace === input.dockerNamespace;
}
