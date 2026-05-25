import { hasText } from '@compartment/utils';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { ApiBoundaryError } from '../../errors/api-boundary-error';
import {
  ArtifactSourceArchiveNotFoundError,
  readArtifactSourceArchive,
} from '../../services/artifact-source-archive.service';
import { SourceUploadArchiveNotFoundError } from '../../services/source-upload-storage.service';

interface BuildArtifactSourceArchiveParams {
  artifactId: string;
}

export function registerGetArtifactSourceArchiveRoute(app: ApiApp): void {
  app.get(
    '/internal/artifacts/:artifactId/source-archive',
    async (
      request: FastifyRequest<{ Params: BuildArtifactSourceArchiveParams }>,
      reply: FastifyReply,
    ): Promise<FastifyReply> => {
      const artifactId: string = requireArtifactId(request.params.artifactId);
      const sourceArchive: Buffer = await readSourceArchiveOrThrowBoundaryError(artifactId);

      reply.header('Content-Type', 'application/gzip');
      return await reply.send(sourceArchive);
    },
  );
}

async function readSourceArchiveOrThrowBoundaryError(artifactId: string): Promise<Buffer> {
  try {
    return await readArtifactSourceArchive(artifactId);
  } catch (error) {
    if (error instanceof ArtifactSourceArchiveNotFoundError || error instanceof SourceUploadArchiveNotFoundError) {
      throw new ApiBoundaryError(404, 'source_archive_not_found', error.message);
    }

    throw error;
  }
}

function requireArtifactId(artifactId: string): string {
  if (!hasText(artifactId)) {
    throw new ApiBoundaryError(400, 'invalid_artifact_id', 'Build artifact id is required.');
  }

  return artifactId;
}
