import type { DeploymentArtifactCleanupTarget } from '@compartment/contracts';
import type { WorkerArtifactRegistryConfig } from '../worker-artifact-registry.types';
import { fetchWorkerArtifactRegistryInternalHttp } from './worker-outbound-http.service';

interface RegistryManifestRef {
  digest: string;
  repository: string;
}

export async function cleanupWorkerArtifacts(
  cleanupArtifacts: DeploymentArtifactCleanupTarget[],
  artifactRegistry: WorkerArtifactRegistryConfig,
): Promise<void> {
  for (const artifact of cleanupArtifacts) {
    try {
      await deleteRegistryManifest(artifact.imageRef, artifactRegistry);
    } catch (error) {
      console.warn(
        {
          artifactId: artifact.artifactId,
          error: error instanceof Error ? error.message : 'Unknown retained artifact cleanup failure.',
          imageRef: artifact.imageRef,
        },
        'Failed to clean retained deployment artifact.',
      );
    }
  }
}

async function deleteRegistryManifest(imageRef: string, artifactRegistry: WorkerArtifactRegistryConfig): Promise<void> {
  const manifest: RegistryManifestRef = parseRegistryManifestRef(imageRef, artifactRegistry.address);
  const response: Response = await fetchWorkerArtifactRegistryInternalHttp(
    artifactRegistry,
    `/v2/${manifest.repository}/manifests/${manifest.digest}`,
    {
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${artifactRegistry.writeCredentials.username}:${artifactRegistry.writeCredentials.password}`,
          'utf8',
        ).toString('base64')}`,
      },
      method: 'DELETE',
    },
  );
  if (response.status !== 202 && response.status !== 404) {
    throw new Error(`Registry manifest delete failed with status ${response.status}.`);
  }
}

function parseRegistryManifestRef(imageRef: string, artifactRegistryAddress: string): RegistryManifestRef {
  const digestSeparatorIndex: number = imageRef.lastIndexOf('@');
  const repositoryPrefix: string = `${artifactRegistryAddress}/`;
  if (
    digestSeparatorIndex <= repositoryPrefix.length ||
    digestSeparatorIndex === imageRef.length - 1 ||
    !imageRef.startsWith(repositoryPrefix)
  ) {
    throw new Error(`Expected cleanup image ref "${imageRef}" to belong to ${artifactRegistryAddress}.`);
  }
  return {
    digest: imageRef.slice(digestSeparatorIndex + 1),
    repository: imageRef.slice(repositoryPrefix.length, digestSeparatorIndex),
  };
}
