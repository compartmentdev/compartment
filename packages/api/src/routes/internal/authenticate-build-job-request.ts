import type { FastifyRequest } from 'fastify';
import { ApiBoundaryError } from '../../errors/api-boundary-error';
import { requireBearerToken } from '../../http/headers';
import { getApiConfig } from '../../runtime/runtime-access';
import { parseBuildJobAccessToken, type BuildJobAccessTokenClaims } from './build-job-access-token';

export interface AuthenticatedBuildJob {
  artifactId: string;
  deploymentId: string;
}

export function authenticateBuildJobRequest(request: FastifyRequest, artifactId: string): AuthenticatedBuildJob {
  const token: string = requireBearerToken(
    request.headers.authorization,
    'build_job_unauthorized',
    'A valid build Job access token is required.',
  );
  const claims: BuildJobAccessTokenClaims | null = parseBuildJobAccessToken(token, getApiConfig().runtimeControlToken);
  if (claims?.artifactId !== artifactId) {
    throw new ApiBoundaryError(401, 'build_job_unauthorized', 'A valid build Job access token is required.');
  }
  return { artifactId: claims.artifactId, deploymentId: claims.deploymentId };
}
