import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { ApiBoundaryError } from '../../errors/api-boundary-error';
import {
  ArtifactSourceArchiveNotFoundError,
  readArtifactSourceArchive,
} from '../../services/artifact-source-archive.service';
import { SourceUploadArchiveNotFoundError } from '../../services/source-upload-storage.service';
import { authenticateBuildJobRequest } from './authenticate-build-job-request';
import { requireArtifactRouteId } from './require-artifact-route-id';

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
      const artifactId: string = requireArtifactRouteId(request.params.artifactId);
      authenticateBuildJobRequest(request, artifactId);
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
