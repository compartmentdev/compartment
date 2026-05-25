import type { BuildArtifactRow } from '../queries/deployments.query.types';
import { cleanupConsumedSourceUpload } from './source-uploads.service';

export async function cleanupDeploymentSourceArchive(artifact: BuildArtifactRow): Promise<void> {
  await cleanupConsumedSourceUpload(requireArtifactSourceUploadId(artifact));
}

function requireArtifactSourceUploadId(artifact: BuildArtifactRow): string {
  if (artifact.sourceUploadId === null) {
    throw new Error(`Build artifact ${artifact.id} has no source upload archive.`);
  }

  return artifact.sourceUploadId;
}
