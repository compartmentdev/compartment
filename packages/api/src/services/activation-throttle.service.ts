import { getApiConfig } from '../runtime/runtime-access';
import {
  buildSubjectThrottleActionInput,
  subjectThrottleBucketKinds,
  subjectThrottleResetBucketKinds,
  type SubjectThrottleBucketKind,
} from './auth-subject-throttle.service';
import { buildSubjectThrottleIdentity } from './auth-throttle-keys.service';
import type { ActivationThrottleIdentity } from './auth-throttle-keys.service.types';
import { clearThrottleBuckets, readThrottleBlock, recordThrottleFailure } from './throttle.service';
import type { ThrottleActionInput, ThrottleBlock } from './throttle.service.types';

const activationThrottleAction: string = 'auth.activate';

export async function readActivationThrottleBlock(email: string, sourceIp: string): Promise<ThrottleBlock | null> {
  return await readThrottleBlock(buildActivationThrottleInput(email, sourceIp));
}

export async function recordFailedActivationAttempt(email: string, sourceIp: string): Promise<void> {
  await recordThrottleFailure(buildActivationThrottleInput(email, sourceIp));
}

export async function clearSuccessfulActivationThrottle(email: string, sourceIp: string): Promise<void> {
  await clearThrottleBuckets(buildActivationThrottleInput(email, sourceIp, subjectThrottleResetBucketKinds));
}

function buildActivationThrottleInput(
  email: string,
  sourceIp: string,
  bucketKinds: readonly SubjectThrottleBucketKind[] = subjectThrottleBucketKinds,
): ThrottleActionInput {
  const identity: ActivationThrottleIdentity = buildSubjectThrottleIdentity(email, sourceIp);

  return buildSubjectThrottleActionInput(
    activationThrottleAction,
    getApiConfig().throttle.activation,
    identity,
    bucketKinds,
  );
}
