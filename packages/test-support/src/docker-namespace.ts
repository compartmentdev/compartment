import { randomUUID } from 'node:crypto';
import { compartmentDockerNamespaceLabelName } from '@compartment/docker';
import {
  listDockerNamespaceContainers,
  listDockerNamespaceImages,
  listDockerNetworkNames,
  removeDockerNamespaceContainer,
  removeDockerNamespaceImage,
  removeDockerNamespaceNetwork,
  removeDockerNamespaceVolume,
} from './docker-namespace.adapter';
import type { DockerNamespaceContainer, DockerNamespaceImage } from './docker-namespace.adapter.types';

const artifactRegistryComponentLabelName: string = 'compartment.component';
const artifactRegistryComponentLabelValue: string = 'artifact-registry';

interface DockerNamespaceSummary {
  containers: DockerNamespaceContainer[];
  imageIds: string[];
  networkNames: string[];
}

export function createDockerTestNamespace(prefix: string = 'compartment-e2e'): string {
  return `${sanitizeDockerNamespace(prefix)}-${randomUUID().slice(0, 8)}`;
}

export async function cleanupDockerTestNamespacesByPrefix(prefix: string): Promise<void> {
  const namespaces: string[] = await readDockerTestNamespacesByPrefix(prefix);

  for (const namespace of namespaces) {
    await cleanupDockerTestNamespace(namespace);
  }
}

async function cleanupDockerTestNamespace(namespace: string): Promise<void> {
  const summary: DockerNamespaceSummary = await readDockerNamespaceSummary(namespace);
  for (const container of summary.containers) {
    await removeDockerNamespaceContainer(container.containerId);
  }
  for (const networkName of summary.networkNames) {
    await removeDockerNamespaceNetwork(networkName);
  }
  await removeDockerNamespaceVolume(buildRegistryVolumeName(namespace));
  for (const imageId of summary.imageIds) {
    await removeDockerNamespaceImage(imageId);
  }
}

async function readDockerNamespaceSummary(namespace: string): Promise<DockerNamespaceSummary> {
  const [containers, networkNames]: [DockerNamespaceContainer[], string[]] = await Promise.all([
    listDockerNamespaceContainers(compartmentDockerNamespaceLabelName, namespace),
    readDockerTestNetworkNames(namespace),
  ]);
  const imageIds: string[] = await readNamespaceReleaseImageIds(namespace, containers);

  return {
    containers,
    imageIds,
    networkNames,
  };
}

async function readNamespaceReleaseImageIds(
  namespace: string,
  containers: DockerNamespaceContainer[],
): Promise<string[]> {
  const labeledImages: DockerNamespaceImage[] = await listDockerNamespaceImages(
    compartmentDockerNamespaceLabelName,
    namespace,
  );
  const labeledImageIds: string[] = labeledImages.map((image: DockerNamespaceImage): string => image.imageId);
  const containerImageIds: string[] = containers.flatMap((container: DockerNamespaceContainer): string[] =>
    isArtifactRegistryContainer(container) ? [] : [container.imageId],
  );

  return [...new Set([...labeledImageIds, ...containerImageIds])];
}

function isArtifactRegistryContainer(container: DockerNamespaceContainer): boolean {
  return container.labels[artifactRegistryComponentLabelName] === artifactRegistryComponentLabelValue;
}

async function readDockerTestNamespacesByPrefix(prefix: string): Promise<string[]> {
  const namespacePrefix: string = `${sanitizeDockerNamespace(prefix)}-`;
  const networkNames: string[] = await listDockerNetworkNames();
  const namespacePattern: RegExp = buildDockerTestNamespacePattern(namespacePrefix);
  const namespaces: string[] = networkNames.flatMap((networkName: string): string[] => {
    const match: RegExpExecArray | null = namespacePattern.exec(networkName);

    return match?.[1] === undefined ? [] : [match[1]];
  });

  return [...new Set(namespaces)];
}

async function readDockerTestNetworkNames(namespace: string): Promise<string[]> {
  const runtimeNetworkNamePrefix: string = `compartment-${namespace}-`;
  const systemNetworkName: string = `${namespace}_system_internal`;
  const networkNames: string[] = await listDockerNetworkNames();

  return networkNames.filter((networkName: string): boolean => {
    return networkName === systemNetworkName || networkName.startsWith(runtimeNetworkNamePrefix);
  });
}

function buildRegistryVolumeName(namespace: string): string {
  return `${namespace}-artifact-registry-data`;
}

function buildDockerTestNamespacePattern(namespacePrefix: string): RegExp {
  return new RegExp(`^(?:compartment-)?(${escapeRegExp(namespacePrefix)}[a-f0-9]{8})(?:[-_]|$)`);
}

function sanitizeDockerNamespace(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_.-]/g, '-');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
