import {
  workerUploadArtifactSbomRequestSchema,
  type WorkerUploadArtifactSbomRequest,
  type WorkerUploadArtifactSbomResponse,
} from '@compartment/contracts';
import type { FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { ApiBoundaryError } from '../../errors/api-boundary-error';
import { InvalidBuildArtifactSbomError, persistBuildArtifactSbom } from '../../services/build-artifact-sbom.service';
import { authenticateBuildJobRequest, type AuthenticatedBuildJob } from './authenticate-build-job-request';
import { requireArtifactRouteId } from './require-artifact-route-id';

interface ArtifactSbomParams {
  artifactId: string;
}

export function registerPostArtifactSbomRoute(app: ApiApp): void {
  app.post('/internal/artifacts/:artifactId/sbom', { bodyLimit: 16 * 1024 * 1024 }, handleArtifactSbomUpload);
}

async function handleArtifactSbomUpload(
  request: FastifyRequest<{ Body: WorkerUploadArtifactSbomRequest; Params: ArtifactSbomParams }>,
): Promise<WorkerUploadArtifactSbomResponse> {
  const artifactId: string = requireArtifactRouteId(request.params.artifactId);
  const buildJob: AuthenticatedBuildJob = authenticateBuildJobRequest(request, artifactId);
  const body: WorkerUploadArtifactSbomRequest = workerUploadArtifactSbomRequestSchema.parse(request.body);
  try {
    return {
      stored: await persistBuildArtifactSbom({ artifactId, deploymentId: buildJob.deploymentId, ...body }),
    };
  } catch (error) {
    if (error instanceof InvalidBuildArtifactSbomError) {
      throw new ApiBoundaryError(400, 'invalid_artifact_sbom', error.message);
    }
    throw error;
  }
}
