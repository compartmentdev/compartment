import type { CompartmentBinaryRequester } from '../http/request.types';

export async function getArtifactSourceArchive(
  request: CompartmentBinaryRequester,
  artifactId: string,
): Promise<Buffer> {
  return await request({
    method: 'GET',
    path: `/internal/artifacts/${encodeURIComponent(artifactId)}/source-archive`,
  });
}
