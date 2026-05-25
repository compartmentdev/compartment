import type { ApiAuthSubjectThrottleConfig } from '../auth-throttle-config.types';
import { authThrottleScope } from './auth-throttle.constants';
import type { SubjectThrottleIdentity } from './auth-throttle-keys.service.types';
import { buildAuthThrottleBuckets, buildAuthThrottlePolicies } from './auth-throttle-builder.service';
import type { ThrottleActionInput, ThrottleBucketDescriptor, ThrottleBucketPolicy } from './throttle.service.types';

export type SubjectThrottleBucketKind = 'source' | 'source_subject' | 'subject';

export const subjectThrottleBucketKinds: readonly SubjectThrottleBucketKind[] = ['source', 'subject', 'source_subject'];
export const subjectThrottleResetBucketKinds: readonly SubjectThrottleBucketKind[] = ['subject', 'source_subject'];

export function buildSubjectThrottleActionInput(
  action: string,
  config: ApiAuthSubjectThrottleConfig,
  identity: SubjectThrottleIdentity,
  bucketKinds: readonly SubjectThrottleBucketKind[] = subjectThrottleBucketKinds,
): ThrottleActionInput {
  return {
    action,
    buckets: buildSubjectThrottleBuckets(identity, bucketKinds),
    policies: buildSubjectThrottlePolicies(config),
    scope: authThrottleScope,
  };
}

function buildSubjectThrottleBuckets(
  identity: SubjectThrottleIdentity,
  bucketKinds: readonly SubjectThrottleBucketKind[],
): readonly ThrottleBucketDescriptor[] {
  return buildAuthThrottleBuckets(bucketKinds, {
    source: identity.sourceKey,
    source_subject: identity.sourceSubjectKey,
    subject: identity.subjectKey,
  });
}

function buildSubjectThrottlePolicies(config: ApiAuthSubjectThrottleConfig): readonly ThrottleBucketPolicy[] {
  return buildAuthThrottlePolicies(subjectThrottleBucketKinds, {
    source: config.source,
    source_subject: config.sourceSubject,
    subject: config.subject,
  });
}
