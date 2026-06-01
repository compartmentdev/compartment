import type Docker from 'dockerode';
import { createDockerClient } from './docker-client';
import { isDockerEngineObjectMissingError, type DockerEngineError } from './docker-engine-error';
import { buildDockerLabelFilters } from './docker-label-filter';
import type { DockerEnsureVolumeInput, DockerListVolumeResult, DockerListVolumesInput } from './docker-models';

interface DockerListVolumesResponse {
  Volumes?: Docker.VolumeInspectInfo[] | null;
}

export async function listDockerVolumes(input: DockerListVolumesInput = {}): Promise<DockerListVolumeResult[]> {
  const docker: Docker = await createDockerClient();
  const response: DockerListVolumesResponse = await docker.listVolumes({
    ...(input.labelFilters !== undefined ? { filters: { label: buildDockerLabelFilters(input.labelFilters) } } : {}),
  });
  const volumes: Docker.VolumeInspectInfo[] = response.Volumes ?? [];

  return volumes.map(
    (volume: Docker.VolumeInspectInfo): DockerListVolumeResult => ({
      labels: volume.Labels,
      name: volume.Name,
    }),
  );
}

export async function ensureDockerVolume(input: DockerEnsureVolumeInput): Promise<void> {
  assertDockerVolumeRequiredLabels(input);

  const docker: Docker = await createDockerClient();
  const volume: Docker.Volume = docker.getVolume(input.volumeName);
  const existingVolume: Docker.VolumeInspectInfo | null = await inspectExistingDockerVolume(volume);
  if (existingVolume !== null) {
    assertDockerVolumeLabels(input.volumeName, existingVolume.Labels, input.labels);
    return;
  }

  await docker.createVolume({
    Labels: input.labels,
    Name: input.volumeName,
  });
}

function assertDockerVolumeRequiredLabels(input: DockerEnsureVolumeInput): void {
  if (Object.keys(input.labels).length === 0) {
    throw new Error(`Docker volume ${input.volumeName} requires at least one ownership label.`);
  }
}

function assertDockerVolumeLabels(
  volumeName: string,
  existingLabels: Record<string, string>,
  requiredLabels: Record<string, string>,
): void {
  for (const [name, value] of Object.entries(requiredLabels)) {
    if (existingLabels[name] !== value) {
      throw new Error(`Docker volume ${volumeName} exists without required label ${name}=${value}.`);
    }
  }
}

async function inspectExistingDockerVolume(volume: Docker.Volume): Promise<Docker.VolumeInspectInfo | null> {
  try {
    return await volume.inspect();
  } catch (error) {
    if (!isDockerVolumeMissingError(error as DockerEngineError)) {
      throw error;
    }

    return null;
  }
}

function isDockerVolumeMissingError(error: DockerEngineError): boolean {
  return isDockerEngineObjectMissingError(error, ['no such volume']);
}
