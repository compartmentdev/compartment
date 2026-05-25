import { getApiConfig } from '../runtime/runtime-access';
import {
  buildSubjectThrottleActionInput,
  subjectThrottleBucketKinds,
  subjectThrottleResetBucketKinds,
  type SubjectThrottleBucketKind,
} from './auth-subject-throttle.service';
import { buildSubjectThrottleIdentity } from './auth-throttle-keys.service';
import type { ResetPasswordThrottleIdentity } from './auth-throttle-keys.service.types';
import { clearThrottleBuckets, readThrottleBlock, recordThrottleFailure } from './throttle.service';
import type { ThrottleActionInput, ThrottleBlock } from './throttle.service.types';

const resetCredentialThrottleAction: string = 'auth.reset_password';

export async function readResetPasswordThrottleBlock(email: string, sourceIp: string): Promise<ThrottleBlock | null> {
  return await readThrottleBlock(buildCredentialResetThrottleInput(email, sourceIp));
}

export async function recordFailedResetPasswordAttempt(email: string, sourceIp: string): Promise<void> {
  await recordThrottleFailure(buildCredentialResetThrottleInput(email, sourceIp));
}

export async function clearSuccessfulResetPasswordThrottle(email: string, sourceIp: string): Promise<void> {
  await clearThrottleBuckets(buildCredentialResetThrottleInput(email, sourceIp, subjectThrottleResetBucketKinds));
}

function buildCredentialResetThrottleInput(
  email: string,
  sourceIp: string,
  bucketKinds: readonly SubjectThrottleBucketKind[] = subjectThrottleBucketKinds,
): ThrottleActionInput {
  const identity: ResetPasswordThrottleIdentity = buildSubjectThrottleIdentity(email, sourceIp);

  return buildSubjectThrottleActionInput(
    resetCredentialThrottleAction,
    getApiConfig().throttle.resetPassword,
    identity,
    bucketKinds,
  );
}
