import {
  ensureDockerImageAvailable,
  inspectDockerContainer,
  removeDockerContainer,
  renameDockerContainer,
  runDockerContainer,
  startDockerContainer,
  stopDockerContainer,
  type DockerInspectContainerResult,
  type DockerNamedVolumeMount,
  type DockerRunContainerInput,
  type DockerRunContainerResult,
} from '@compartment/docker';
import type { NodeResourceRequest, NodeResourceResponse, NodeResourceVolume } from '@compartment/contracts';
import type { RuntimeDeployConfig } from './runtime.types';
import { buildRuntimeResourceLabels } from './runtime-resource-labels';
import {
  buildResourceContainerName,
  buildResourceNetworkAlias,
  buildResourceVolumeName,
  buildRuntimeResourceNetworkName,
} from './runtime-names.service';
import {
  assertRuntimeResourceNetworkFreeEndpoints,
  ensureRuntimeResourceNetwork,
} from './runtime-network-capacity.service';
import { reconcileRuntimeNetworksBestEffort } from './runtime-network-reconcile.service';
import { removeRuntimeResourceContainerBestEffort } from './runtime-resource-cleanup.service';
import { waitForResourceStartupReadiness } from './runtime-resource-readiness-wait.service';
import { buildUserResourceWritableSecurityProfile } from './runtime-security-profile.service';
import { normalizeRuntimeNetworkDockerError, type RuntimeNetworkErrorInput } from './runtime-network-error.service';

export async function reconcileRuntimeResource(
  input: NodeResourceRequest,
  config: RuntimeDeployConfig,
): Promise<NodeResourceResponse> {
  try {
    await ensureDockerImageAvailable({
      imageRef: input.definition.image,
      registryCredentials: config.runtimeRegistryCredentials,
    });
    return await replacePreparedRuntimeResource(input, config);
  } catch (error) {
    await reconcileRuntimeNetworksBestEffort(config);
    throw normalizeRuntimeNetworkDockerError(error as RuntimeNetworkErrorInput, 'Unexpected runtime resource error.');
  }
}

export async function startRuntimeResource(
  input: NodeResourceRequest,
  config: RuntimeDeployConfig,
): Promise<NodeResourceResponse> {
  try {
    await ensureDockerImageAvailable({
      imageRef: input.definition.image,
      registryCredentials: config.runtimeRegistryCredentials,
    });
    return await startPreparedRuntimeResource(input, config);
  } catch (error) {
    await reconcileRuntimeNetworksBestEffort(config);
    throw normalizeRuntimeNetworkDockerError(error as RuntimeNetworkErrorInput, 'Unexpected runtime resource error.');
  }
}

async function replacePreparedRuntimeResource(
  input: NodeResourceRequest,
  config: RuntimeDeployConfig,
): Promise<NodeResourceResponse> {
  const containerRef: string = buildResourceContainerName(input, config.dockerNamespace);
  const backupContainerRef: string = `${containerRef}-previous`;
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
    await removeRuntimeResourceContainerBestEffort(containerRef);
    await renameDockerContainer({ containerRef: backupContainerRef, nextContainerName: containerRef });
    await startDockerContainer({ containerRef });
    throw error;
  }
}

async function startPreparedRuntimeResource(
  input: NodeResourceRequest,
  config: RuntimeDeployConfig,
): Promise<NodeResourceResponse> {
  await ensureRuntimeResourceNetwork(input, config);
  await assertRuntimeResourceNetworkFreeEndpoints(input, config, 1, 'starting resource container');
  const container: DockerRunContainerResult = await runDockerContainer(buildResourceContainerInput(input, config));
  try {
    await waitForResourceStartupReadiness(input, config, container.containerId);
  } catch (error) {
    await removeRuntimeResourceContainerBestEffort(container.containerId);
    throw error;
  }

  return {
    containerId: container.containerId,
    hostname: input.hostname,
    status: 'running',
  };
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
    securityProfile: buildUserResourceWritableSecurityProfile(
      'Resource images can require writable runtime paths outside declared data volumes.',
    ),
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
