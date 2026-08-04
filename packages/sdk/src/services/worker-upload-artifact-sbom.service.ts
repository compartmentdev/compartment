import {
  workerArtifactSbomPath,
  workerUploadArtifactSbomRequestSchema,
  workerUploadArtifactSbomResponseSchema,
  type WorkerUploadArtifactSbomRequest,
  type WorkerUploadArtifactSbomResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function uploadArtifactSbom(
  request: CompartmentRequester,
  artifactId: string,
  body: WorkerUploadArtifactSbomRequest,
): Promise<WorkerUploadArtifactSbomResponse> {
  workerUploadArtifactSbomRequestSchema.parse(body);
  return await request<WorkerUploadArtifactSbomResponse, WorkerUploadArtifactSbomRequest>({
    body,
    method: 'POST',
    path: workerArtifactSbomPath(artifactId),
    schema: workerUploadArtifactSbomResponseSchema,
  });
}
