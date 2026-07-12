import type { WorkerArtifactCleanupTarget } from '@compartment/contracts';
import type { WorkerArtifactRegistryConfig } from '../worker-artifact-registry.types';
import { fetchWorkerArtifactRegistryInternalHttp } from './worker-outbound-http.service';

interface RegistryManifestRef {
  digest: string;
  repository: string;
}

export async function cleanupWorkerArtifacts(
  cleanupArtifacts: WorkerArtifactCleanupTarget[],
  artifactRegistry: WorkerArtifactRegistryConfig,
  dockerNamespace: string,
): Promise<void> {
  if (cleanupArtifacts.length === 0) {
    return;
  }

  const deletedManifestCount: number = await deleteArtifactManifests(cleanupArtifacts, artifactRegistry);
  if (deletedManifestCount === 0) {
    return;
  }
  if (artifactRegistry.mode === 'bundled') {
    warnBundledRegistryGcSkipped(dockerNamespace);
  }
}

async function deleteArtifactManifests(
  cleanupArtifacts: WorkerArtifactCleanupTarget[],
  artifactRegistry: WorkerArtifactRegistryConfig,
): Promise<number> {
  let deletedManifestCount: number = 0;

  for (const cleanupArtifact of cleanupArtifacts) {
    const didDeleteManifest: boolean = await deleteArtifactManifest(cleanupArtifact, artifactRegistry);
    deletedManifestCount += didDeleteManifest ? 1 : 0;
  }

  return deletedManifestCount;
}

async function deleteArtifactManifest(
  cleanupArtifact: WorkerArtifactCleanupTarget,
  artifactRegistry: WorkerArtifactRegistryConfig,
): Promise<boolean> {
  try {
    return await deleteRegistryManifest(cleanupArtifact.imageRef, artifactRegistry);
  } catch (error) {
    warnArtifactCleanupFailure(
      cleanupArtifact.imageRef,
      error instanceof Error ? error.message : 'Unknown retained deployment artifact cleanup failure.',
    );
    return false;
  }
}

async function deleteRegistryManifest(
  imageRef: string,
  artifactRegistry: WorkerArtifactRegistryConfig,
): Promise<boolean> {
  const manifest: RegistryManifestRef = parseRegistryManifestRef(imageRef, artifactRegistry.address);
  const response: Response = await fetchWorkerArtifactRegistryInternalHttp(
    artifactRegistry,
    `/v2/${manifest.repository}/manifests/${manifest.digest}`,
    buildRegistryManifestDeleteRequestInit(artifactRegistry),
  );

  if (response.status === 202) {
    return true;
  }
  if (response.status === 404) {
    return false;
  }

  throw new Error(`Registry manifest delete failed with status ${response.status}.`);
}

function buildRegistryManifestDeleteRequestInit(artifactRegistry: WorkerArtifactRegistryConfig): RequestInit {
  return {
    headers: {
      Authorization: buildBasicAuthorizationHeader(
        artifactRegistry.writeCredentials.username,
        artifactRegistry.writeCredentials.password,
      ),
    },
    method: 'DELETE',
  };
}

function buildBasicAuthorizationHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
}

function warnArtifactCleanupFailure(imageRef: string, errorMessage: string): void {
  console.warn(
    {
      error: errorMessage,
      imageRef,
    },
    'Failed to clean retained deployment artifact.',
  );
}

function warnBundledRegistryGcSkipped(dockerNamespace: string): void {
  console.warn(
    {
      dockerNamespace,
      reason: 'Bundled registry garbage collection requires a read-only maintenance path.',
    },
    'Skipped bundled registry garbage collection after deleting retained deployment manifests.',
  );
}

function parseRegistryManifestRef(imageRef: string, artifactRegistryAddress: string): RegistryManifestRef {
  const digestSeparatorIndex: number = imageRef.lastIndexOf('@');
  if (digestSeparatorIndex <= 0 || digestSeparatorIndex === imageRef.length - 1) {
    throw new Error(`Expected registry image ref with digest, received "${imageRef}".`);
  }

  const repositoryRef: string = imageRef.slice(0, digestSeparatorIndex);
  const digest: string = imageRef.slice(digestSeparatorIndex + 1);
  const repositoryPrefix: string = `${artifactRegistryAddress}/`;
  if (!repositoryRef.startsWith(repositoryPrefix)) {
    throw new Error(`Expected cleanup image ref "${imageRef}" to belong to ${artifactRegistryAddress}.`);
  }

  return {
    digest,
    repository: repositoryRef.slice(repositoryPrefix.length),
  };
}
