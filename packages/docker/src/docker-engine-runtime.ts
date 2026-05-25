import type Docker from 'dockerode';
import { createDockerClient, hasText } from './docker-client';
import { isDockerEngineObjectMissingError } from './docker-engine-error';
import { buildDockerContainerCreateOptions } from './docker-engine-runtime-create';
import { parseDockerMultiplexedLogBuffer } from './docker-log-buffer';
import type {
  DockerInspectConfigRecord,
  DockerInspectNetworkSettings,
  DockerInspectPortBinding,
  DockerInspectPortBindings,
} from './docker-engine-runtime.types';
import type {
  DockerInspectContainerInput,
  DockerInspectContainerResult,
  DockerLogLine,
  DockerNamedVolumeMount,
  DockerNetworkAttachment,
  DockerPublishedPort,
  DockerRemoveContainerInput,
  DockerRemoveVolumeInput,
  DockerRunContainerResult,
  DockerTailLogsInput,
  DockerRunContainerInput,
} from './docker-models';

export async function createDockerEngineContainer(input: DockerRunContainerInput): Promise<DockerRunContainerResult> {
  const docker: Docker = await createDockerClient();
  await ensureDockerEngineVolumes(docker, input.namedVolumes ?? []);
  const container: Docker.Container = await docker.createContainer(buildDockerContainerCreateOptions(input));
  await container.start();

  return {
    containerId: container.id,
  };
}

export async function removeDockerEngineVolume(input: DockerRemoveVolumeInput): Promise<void> {
  const docker: Docker = await createDockerClient();

  try {
    await docker.getVolume(input.volumeName).remove({ force: true });
  } catch (error) {
    if (typeof error === 'object' && error !== null && isDockerVolumeMissingError(error)) {
      return;
    }

    throw error;
  }
}

export async function removeDockerEngineContainer(input: DockerRemoveContainerInput): Promise<void> {
  const docker: Docker = await createDockerClient();

  try {
    await docker.getContainer(input.containerRef).remove({ force: true });
  } catch (error) {
    if (typeof error === 'object' && error !== null && isDockerContainerMissingError(error)) {
      return;
    }

    throw error;
  }
}

export async function inspectDockerEngineContainer(
  input: DockerInspectContainerInput,
): Promise<DockerInspectContainerResult | null> {
  const docker: Docker = await createDockerClient();

  try {
    const container: Docker.ContainerInspectInfo = await docker.getContainer(input.containerRef).inspect();
    return parseDockerInspectContainerResult(container);
  } catch (error) {
    if (typeof error === 'object' && error !== null && isDockerContainerMissingError(error)) {
      return null;
    }

    throw error;
  }
}

export async function readDockerEngineContainerLogs(input: DockerTailLogsInput): Promise<DockerLogLine[]> {
  const docker: Docker = await createDockerClient();

  let logsBuffer: Buffer;
  try {
    logsBuffer = await docker.getContainer(input.containerId).logs({
      follow: false,
      ...(input.since !== undefined ? { since: readDockerLogsSince(input.since) } : {}),
      stderr: true,
      stdout: true,
      ...(input.tailLines !== undefined ? { tail: input.tailLines } : {}),
      timestamps: true,
    });
  } catch (error) {
    if (typeof error === 'object' && error !== null && isDockerContainerMissingError(error)) {
      return [];
    }

    throw error;
  }

  return parseDockerMultiplexedLogBuffer(logsBuffer);
}

function readDockerLogsSince(since: string): number {
  const timestamp: number = Date.parse(since);
  if (Number.isNaN(timestamp)) {
    throw new Error(`Expected a valid since timestamp but received "${since}".`);
  }

  return Math.floor(timestamp / 1000);
}

export async function ensureDockerEngineVolumes(docker: Docker, volumes: DockerNamedVolumeMount[]): Promise<void> {
  for (const volume of volumes) {
    await docker.createVolume({
      Labels: volume.labels,
      Name: volume.name,
    });
  }
}

function parseDockerInspectContainerResult(container: Docker.ContainerInspectInfo): DockerInspectContainerResult {
  const networkAttachments: DockerNetworkAttachment[] = readDockerNetworkAttachments(container);

  return {
    containerId: container.Id,
    imageRef: container.Config.Image,
    isRunning: readDockerInspectRunningState(container),
    labels: readDockerInspectLabels(container.Config),
    ...(networkAttachments.length > 0 ? { networkAttachments } : {}),
    publishedPorts: readDockerPublishedPorts(container.NetworkSettings.Ports),
  };
}

function readDockerInspectRunningState(container: Docker.ContainerInspectInfo): boolean {
  return container.State.Running === true;
}

function readDockerInspectLabels(config: DockerInspectConfigRecord): Record<string, string> {
  return config.Labels ?? {};
}

function readDockerNetworkAttachments(container: Docker.ContainerInspectInfo): DockerNetworkAttachment[] {
  return Object.entries(readDockerInspectNetworks(container)).map(
    ([name, network]: [string, Docker.EndpointSettings]): DockerNetworkAttachment => ({
      ipAddress: hasText(network.IPAddress) ? network.IPAddress : null,
      name,
    }),
  );
}

function readDockerInspectNetworks(container: Docker.ContainerInspectInfo): Record<string, Docker.EndpointSettings> {
  const networkSettings: DockerInspectNetworkSettings = container.NetworkSettings;
  if (networkSettings.Networks === undefined || networkSettings.Networks === null) {
    return {};
  }

  return networkSettings.Networks;
}

function readDockerPublishedPorts(ports: DockerInspectPortBindings): DockerPublishedPort[] {
  return Object.entries(ports).flatMap(
    ([containerPortKey, bindings]: [string, DockerInspectPortBinding[] | null | undefined]): DockerPublishedPort[] => {
      if (bindings === null || bindings === undefined) {
        return [];
      }

      const containerPort: number = parseDockerContainerPort(containerPortKey);

      return bindings.map(
        (binding: DockerInspectPortBinding): DockerPublishedPort => ({
          containerPort,
          hostIp: binding.HostIp,
          hostPort: Number.parseInt(binding.HostPort, 10),
        }),
      );
    },
  );
}

function parseDockerContainerPort(portKey: string): number {
  const [rawPort] = portKey.split('/', 1);
  const containerPort: number = Number.parseInt(rawPort ?? '', 10);
  if (!Number.isInteger(containerPort) || containerPort <= 0) {
    throw new Error(`Expected a valid docker container port but received "${portKey}".`);
  }

  return containerPort;
}

export function isDockerContainerMissingError(error: object): boolean {
  return isDockerEngineObjectMissingError(error, ['no such object', 'no such container']);
}

function isDockerVolumeMissingError(error: object): boolean {
  return isDockerEngineObjectMissingError(error, ['no such volume']);
}
