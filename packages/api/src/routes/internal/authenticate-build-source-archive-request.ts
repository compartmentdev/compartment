import { readHeaderValue, verifyBuildSourceArchiveCredential } from '@compartment/utils';
import type { HookHandlerDoneFunction, FastifyReply, FastifyRequest } from 'fastify';
import { ApiBoundaryError } from '../../errors/api-boundary-error';
import { requireBearerToken } from '../../http/headers';
import { getApiConfig } from '../../runtime/runtime-access';
import type { BuildArtifactSourceArchiveParams } from './get-artifact-source-archive.route.types';

const unauthorizedCode: string = 'build_source_archive_unauthorized';
const unauthorizedMessage: string = 'A valid build source archive credential is required.';

/**
 * Build Pods run tenant-authored code, so they carry a per-build credential instead of the installation runtime
 * control token. The credential names the one artifact that build may read, and it is checked against the artifact
 * this request asks for. Verification is a single HMAC with no database read, on a route public ingress never
 * exposes, so this route takes no throttle or cooldown.
 */
export function authenticateBuildSourceArchiveRequest(
  request: FastifyRequest,
  _reply: FastifyReply,
  done: HookHandlerDoneFunction,
): void {
  const params: BuildArtifactSourceArchiveParams = request.params as BuildArtifactSourceArchiveParams;
  const credential: string = requireBearerToken(
    readHeaderValue(request.headers.authorization),
    unauthorizedCode,
    unauthorizedMessage,
  );
  if (!verifyBuildSourceArchiveCredential(getApiConfig().runtimeControlToken, credential, params.artifactId)) {
    throw new ApiBoundaryError(401, unauthorizedCode, unauthorizedMessage);
  }
  done();
}
