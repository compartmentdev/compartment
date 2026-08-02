import type { DeploymentArtifactCleanupTarget } from '@compartment/contracts';
import type { WorkerArtifactRegistryConfig } from '../worker-artifact-registry.types';
import { fetchWorkerArtifactRegistryInternalHttp } from './worker-outbound-http.service';
import { issueCleanupCredential } from '../registry-credentials';
import type { RegistryCredential } from '../registry-credentials.types';

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
  const manifest: RegistryManifestRef = parseRegistryManifestRef(imageRef);
  const credential: RegistryCredential = issueCleanupCredential(
    artifactRegistry.credentialSigningKey,
    readProjectId(manifest.repository),
    manifest.repository,
    manifest.digest,
  );
  const response: Response = await fetchWorkerArtifactRegistryInternalHttp(
    artifactRegistry,
    `/v2/${manifest.repository}/manifests/${manifest.digest}`,
    {
      headers: {
        Authorization: buildBasicAuthorization(credential),
      },
      method: 'DELETE',
    },
  );
  if (![202, 404].includes(response.status)) {
    throw new Error(`Registry manifest delete failed with status ${response.status}.`);
  }
}

function readProjectId(repository: string): string {
  const projectRepositoryPattern: RegExp =
    /^projects\/([A-Za-z0-9][A-Za-z0-9_-]*)\/services\/[A-Za-z0-9][A-Za-z0-9_-]*$/u;
  const match: RegExpExecArray | null = projectRepositoryPattern.exec(repository);
  if (match?.[1] === undefined) {
    throw new Error('Artifact cleanup repository does not contain an immutable project ID.');
  }
  return match[1];
}

function buildBasicAuthorization(credential: RegistryCredential): string {
  const encodedCredential: string = Buffer.from(`${credential.username}:${credential.password}`, 'utf8').toString(
    'base64',
  );
  return `Basic ${encodedCredential}`;
}

function parseRegistryManifestRef(imageRef: string): RegistryManifestRef {
  const digestSeparatorIndex: number = imageRef.lastIndexOf('@');
  const repositoryMarker: string = '/projects/';
  const repositoryIndex: number = imageRef.lastIndexOf(repositoryMarker);
  if (
    repositoryIndex < 1 ||
    digestSeparatorIndex <= repositoryIndex + repositoryMarker.length ||
    digestSeparatorIndex === imageRef.length - 1 ||
    !/^sha256:[a-f0-9]{64}$/u.test(imageRef.slice(digestSeparatorIndex + 1))
  ) {
    throw new Error(`Expected cleanup image ref "${imageRef}" to contain a Compartment artifact digest.`);
  }
  return {
    digest: imageRef.slice(digestSeparatorIndex + 1),
    repository: imageRef.slice(repositoryIndex + 1, digestSeparatorIndex),
  };
}
