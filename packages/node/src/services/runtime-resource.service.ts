import {
  ensureDockerImageAvailable,
  inspectDockerContainer,
  removeDockerContainer,
  renameDockerContainer,
  runDockerContainer,
  startDockerContainer,
  stopDockerContainer,
  type DockerContainerSecurityProfile,
  type DockerInspectContainerResult,
  type DockerNamedVolumeMount,
  type DockerRunContainerInput,
  type DockerRunContainerResult,
} from '@compartment/docker';
import type {
  NodeResourceReadiness,
  NodeResourceRequest,
  NodeResourceResponse,
  NodeResourceVolume,
} from '@compartment/contracts';
import type { RuntimeDeployConfig } from './runtime.types';
import { buildRuntimeResourceLabels } from './runtime-resource-labels';
import {
  buildResourceContainerName,
  buildResourceNetworkAlias,
  buildResourceVolumeName,
  buildRuntimeResourceNetworkName,
} from './runtime-names.service';
import { canConnectToRuntimeHost } from './runtime-resource-connectivity.service';
import { continueResourceReadinessPolling, resolveResourceReadinessHost } from './runtime-resource-readiness.service';
import { ensureOwnedRuntimeNetwork } from './runtime-network-ownership.service';
import { buildUserResourceWritableSecurityProfile } from './runtime-security-profile.service';

export async function reconcileRuntimeResource(
  input: NodeResourceRequest,
  config: RuntimeDeployConfig,
): Promise<NodeResourceResponse> {
  await ensureDockerImageAvailable({
    imageRef: input.definition.image,
    registryCredentials: config.runtimeRegistryCredentials,
  });
  return await replacePreparedRuntimeResource(input, config);
}

export async function startRuntimeResource(
  input: NodeResourceRequest,
  config: RuntimeDeployConfig,
): Promise<NodeResourceResponse> {
  await ensureDockerImageAvailable({
    imageRef: input.definition.image,
    registryCredentials: config.runtimeRegistryCredentials,
  });
  return await startPreparedRuntimeResource(input, config);
}

async function replacePreparedRuntimeResource(
  input: NodeResourceRequest,
  config: RuntimeDeployConfig,
): Promise<NodeResourceResponse> {
  const containerRef: string = buildResourceContainerName(input, config.dockerNamespace);
  const backupContainerRef: string = buildResourceReplacementBackupRef(containerRef);
  const existingContainer: DockerInspectContainerResult | null = await restoreResourceReplacementBackup(
    containerRef,
    backupContainerRef,
  );
  if (existingContainer === null) {
    return await startPreparedRuntimeResource(input, config);
  }

  await prepareResourceReplacement(containerRef, backupContainerRef);
  return await startResourceReplacement(input, config, containerRef, backupContainerRef);
}

async function restoreResourceReplacementBackup(
  containerRef: string,
  backupContainerRef: string,
): Promise<DockerInspectContainerResult | null> {
  const existingContainer: DockerInspectContainerResult | null = await inspectDockerContainer({ containerRef });
  if (existingContainer !== null) {
    return existingContainer;
  }

  const backupContainer: DockerInspectContainerResult | null = await inspectDockerContainer({
    containerRef: backupContainerRef,
  });
  if (backupContainer === null) {
    return null;
  }

  await renameDockerContainer({ containerRef: backupContainerRef, nextContainerName: containerRef });
  if (backupContainer.isRunning !== true) {
    await startDockerContainer({ containerRef });
  }

  return backupContainer;
}

async function prepareResourceReplacement(containerRef: string, backupContainerRef: string): Promise<void> {
  await removeDockerContainer({ containerRef: backupContainerRef });
  await renameDockerContainer({ containerRef, nextContainerName: backupContainerRef });
  try {
    await stopDockerContainer({ containerRef: backupContainerRef });
  } catch (error) {
    await renameDockerContainer({ containerRef: backupContainerRef, nextContainerName: containerRef });
    throw error;
  }
}

async function startResourceReplacement(
  input: NodeResourceRequest,
  config: RuntimeDeployConfig,
  containerRef: string,
  backupContainerRef: string,
): Promise<NodeResourceResponse> {
  try {
    const response: NodeResourceResponse = await startPreparedRuntimeResource(input, config);
    await removeDockerContainer({ containerRef: backupContainerRef });
    return response;
  } catch (error) {
    await removeDockerContainer({ containerRef });
    await renameDockerContainer({ containerRef: backupContainerRef, nextContainerName: containerRef });
    await startDockerContainer({ containerRef });
    throw error;
  }
}

async function startPreparedRuntimeResource(
  input: NodeResourceRequest,
  config: RuntimeDeployConfig,
): Promise<NodeResourceResponse> {
  await ensureOwnedRuntimeNetwork({
    dockerNamespace: config.dockerNamespace,
    networkName: buildRuntimeResourceNetworkName(input, config.dockerNamespace),
  });
  const container: DockerRunContainerResult = await runDockerContainer(buildResourceContainerInput(input, config));
  await waitForResourceReadiness(input, config, container.containerId);

  return {
    containerId: container.containerId,
    hostname: input.hostname,
    status: 'running',
  };
}

function buildResourceReplacementBackupRef(containerRef: string): string {
  return `${containerRef}-previous`;
}

function buildResourceContainerInput(input: NodeResourceRequest, config: RuntimeDeployConfig): DockerRunContainerInput {
  const resourceNetworkName: string = buildRuntimeResourceNetworkName(input, config.dockerNamespace);
  const resourceLabels: Record<string, string> = buildRuntimeResourceLabels(config.dockerNamespace, input);

  return {
    containerName: buildResourceContainerName(input, config.dockerNamespace),
    ...(input.definition.command.length > 0 ? { command: input.definition.command } : {}),
    env: buildResourceEnv(input),
    imageRef: input.definition.image,
    labels: resourceLabels,
    namedVolumes: buildResourceNamedVolumes(input, config, resourceLabels),
    network: {
      aliases: [input.hostname, buildResourceNetworkAlias(input, config.dockerNamespace)],
      name: resourceNetworkName,
    },
    restartPolicy: {
      name: input.definition.restart.policy,
    },
    securityProfile: buildResourceContainerSecurityProfile(),
  };
}

function buildResourceEnv(input: NodeResourceRequest): Record<string, string> {
  return Object.fromEntries(
    input.definition.env.map((value: { keyName: string; value: string }): [string, string] => [
      value.keyName,
      value.value,
    ]),
  );
}

function buildResourceContainerSecurityProfile(): DockerContainerSecurityProfile {
  return buildUserResourceWritableSecurityProfile(
    'Resource images can require writable runtime paths outside declared data volumes.',
  );
}

function buildResourceNamedVolumes(
  input: NodeResourceRequest,
  config: RuntimeDeployConfig,
  resourceLabels: Record<string, string>,
): DockerNamedVolumeMount[] {
  return input.volumes.map(
    (volume: NodeResourceVolume): DockerNamedVolumeMount => ({
      labels: resourceLabels,
      name: buildResourceVolumeName(input, config.dockerNamespace, volume.name),
      targetPath: volume.mountPath,
    }),
  );
}

async function waitForResourceReadiness(
  input: NodeResourceRequest,
  config: RuntimeDeployConfig,
  containerId: string,
): Promise<void> {
  if (input.definition.readiness === null) {
    await ensureResourceContainerIsRunning(containerId);
    return;
  }

  const readiness: NodeResourceReadiness = input.definition.readiness;
  const deadline: number = Date.now() + readiness.timeoutMs;
  for (;;) {
    if (await canReachRuntimeResourceReadiness(input, config, containerId, readiness.port, deadline)) {
      return;
    }
    if (!(await continueResourceReadinessPolling(deadline))) {
      break;
    }
  }

  await removeDockerContainer({ containerRef: buildResourceContainerName(input, config.dockerNamespace) });
  throw new Error(`Resource ${input.resourceName} did not become ready before ${readiness.timeoutMs}ms.`);
}

async function canReachRuntimeResourceReadiness(
  input: NodeResourceRequest,
  config: RuntimeDeployConfig,
  containerId: string,
  port: number,
  deadline: number,
): Promise<boolean> {
  return await canReachResourceReadinessPort(
    containerId,
    buildRuntimeResourceNetworkName(input, config.dockerNamespace),
    port,
    deadline,
  );
}

async function canReachResourceReadinessPort(
  containerId: string,
  resourceNetworkName: string,
  port: number,
  deadline: number,
): Promise<boolean> {
  const readinessHost: string | null = await resolveReadinessHost(containerId, resourceNetworkName);
  return readinessHost !== null && (await canConnectToRuntimeHost(readinessHost, port, deadline));
}

async function resolveReadinessHost(containerId: string, resourceNetworkName: string): Promise<string | null> {
  try {
    return await resolveResourceReadinessHost(containerId, resourceNetworkName);
  } catch {
    return null;
  }
}

async function ensureResourceContainerIsRunning(containerId: string): Promise<void> {
  const container: DockerInspectContainerResult | null = await inspectDockerContainer({ containerRef: containerId });
  if (container?.isRunning !== true) {
    throw new Error(`Expected resource container ${containerId} to remain running after startup.`);
  }
}
