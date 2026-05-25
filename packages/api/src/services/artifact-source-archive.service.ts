import type { BuildArtifactRow } from '../queries/deployments.query.types';
import { findBuildArtifactById } from '../queries/deployments.query';
import { readSourceUploadArchive } from './source-upload-storage.service';

export async function readArtifactSourceArchive(artifactId: string): Promise<Buffer> {
  const artifact: BuildArtifactRow & { sourceUploadId: string } = requireArtifactWithSourceUpload(
    await findBuildArtifactById(artifactId),
    artifactId,
  );
  return await readSourceUploadArchive(artifact.sourceUploadId);
}

export class ArtifactSourceArchiveNotFoundError extends Error {
  constructor(artifactId: string) {
    super(`Source archive for build artifact ${artifactId} was not found.`);
    this.name = 'ArtifactSourceArchiveNotFoundError';
  }
}

function requireArtifactWithSourceUpload(
  artifact: BuildArtifactRow | undefined,
  artifactId: string,
): BuildArtifactRow & { sourceUploadId: string } {
  if (artifact?.sourceUploadId === undefined || artifact.sourceUploadId === null) {
    throw new ArtifactSourceArchiveNotFoundError(artifactId);
  }

  return artifact as BuildArtifactRow & { sourceUploadId: string };
}
