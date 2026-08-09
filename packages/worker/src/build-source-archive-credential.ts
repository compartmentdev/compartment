import { issueBuildSourceArchiveCredential } from '@compartment/utils';

const credentialGraceSeconds: number = 5 * 60;

/**
 * The build Job's `activeDeadlineSeconds` is the same build timeout and bounds every Pod attempt its
 * `backoffLimit` permits, so a credential cut to that deadline outlives exactly the Pods that may
 * legitimately use it. The grace absorbs the gap between minting and Job creation plus clock skew
 * between the worker and the API.
 */
export function issueBuildJobSourceArchiveCredential(
  runtimeControlToken: string,
  artifactId: string,
  buildTimeoutMs: number,
  nowSeconds: number = Math.floor(Date.now() / 1_000),
): string {
  return issueBuildSourceArchiveCredential(
    runtimeControlToken,
    artifactId,
    nowSeconds + Math.ceil(buildTimeoutMs / 1_000) + credentialGraceSeconds,
  );
}
