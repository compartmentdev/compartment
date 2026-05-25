import { removeDockerContainer, removeDockerNetwork, removeDockerVolume } from '@compartment/docker';
import Docker from 'dockerode';
import type { DockerNamespaceContainer, DockerNamespaceImage } from './docker-namespace.adapter.types';

interface DockerImageRemoveErrorRecord {
  json?: DockerImageRemoveJsonRecord | null | undefined;
  message?: string | null | undefined;
  reason?: string | null | undefined;
  statusCode?: number | null | undefined;
}

interface DockerImageRemoveJsonRecord {
  message?: string | null | undefined;
}

type DockerImageRemoveError = DockerImageRemoveErrorRecord | Error | null | undefined;

export async function listDockerNamespaceContainers(
  labelName: string,
  labelValue: string,
): Promise<DockerNamespaceContainer[]> {
  const docker: Docker = createTestSupportDockerClient();
  const containers: Docker.ContainerInfo[] = await docker.listContainers({
    all: true,
    filters: {
      label: [buildDockerLabelFilter(labelName, labelValue)],
    },
  });

  return containers.map(
    (container: Docker.ContainerInfo): DockerNamespaceContainer => ({
      containerId: container.Id,
      imageId: container.ImageID,
      labels: container.Labels,
    }),
  );
}

export async function listDockerNamespaceImages(
  labelName: string,
  labelValue: string,
): Promise<DockerNamespaceImage[]> {
  const docker: Docker = createTestSupportDockerClient();
  const images: Docker.ImageInfo[] = await docker.listImages({
    filters: {
      label: [buildDockerLabelFilter(labelName, labelValue)],
    },
  });

  return images.map(
    (image: Docker.ImageInfo): DockerNamespaceImage => ({
      imageId: image.Id,
    }),
  );
}

export async function listDockerNetworkNames(): Promise<string[]> {
  const docker: Docker = createTestSupportDockerClient();
  const networks: Docker.NetworkInspectInfo[] = await docker.listNetworks();

  return networks.map((network: Docker.NetworkInspectInfo): string => network.Name);
}

export async function removeDockerNamespaceContainer(containerId: string): Promise<void> {
  await removeDockerContainer({ containerRef: containerId });
}

export async function removeDockerNamespaceImage(imageId: string): Promise<void> {
  const docker: Docker = createTestSupportDockerClient();
  try {
    await docker.getImage(imageId).remove();
  } catch (error) {
    if (!isDockerImageRemoveNoop(error as DockerImageRemoveError)) {
      throw error;
    }
  }
}

export async function removeDockerNamespaceNetwork(networkName: string): Promise<void> {
  await removeDockerNetwork({ networkName });
}

export async function removeDockerNamespaceVolume(volumeName: string): Promise<void> {
  await removeDockerVolume({ volumeName });
}

function createTestSupportDockerClient(): Docker {
  return new Docker();
}

function isDockerImageRemoveNoop(error: DockerImageRemoveError): boolean {
  if (error === null || error === undefined) {
    return false;
  }

  const errorRecord: DockerImageRemoveErrorRecord = error;
  if (errorRecord.statusCode === 404 || errorRecord.statusCode === 409) {
    return true;
  }

  const errorText: string = [
    errorRecord.message,
    errorRecord.reason,
    readDockerImageRemoveJsonMessage(errorRecord.json),
  ]
    .filter((value: string | null | undefined): value is string => typeof value === 'string' && value !== '')
    .join(' ')
    .toLowerCase();

  return errorText.includes('no such image') || errorText.includes('image is being used by');
}

function readDockerImageRemoveJsonMessage(value: DockerImageRemoveJsonRecord | null | undefined): string | null {
  return typeof value?.message === 'string' ? value.message : null;
}

function buildDockerLabelFilter(labelName: string, labelValue: string): string {
  return `${labelName}=${labelValue}`;
}
