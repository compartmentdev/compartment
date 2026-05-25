import type { LoginRequest } from '@compartment/contracts';
import type { ApiAuthLoginThrottleConfig } from '../auth-throttle-config.types';
import { getApiConfig } from '../runtime/runtime-access';
import { buildAuthThrottleBuckets, buildAuthThrottlePolicies } from './auth-throttle-builder.service';
import { authThrottleScope } from './auth-throttle.constants';
import { buildLoginThrottleIdentity } from './auth-throttle-keys.service';
import type { LoginThrottleIdentity } from './auth-throttle-keys.service.types';
import { clearThrottleBuckets, readThrottleBlock, recordThrottleFailure } from './throttle.service';
import type {
  ThrottleActionInput,
  ThrottleBlock,
  ThrottleBucketDescriptor,
  ThrottleBucketPolicy,
} from './throttle.service.types';

const loginThrottleAction: string = 'auth.login';
type LoginThrottleBucketKind = 'account' | 'source' | 'source_account';
const loginThrottleBucketKinds: readonly LoginThrottleBucketKind[] = ['source', 'account', 'source_account'];
const loginThrottleResetBucketKinds: readonly LoginThrottleBucketKind[] = ['account', 'source_account'];

export async function readLoginThrottleBlock(
  requestBody: LoginRequest,
  sourceIp: string,
): Promise<ThrottleBlock | null> {
  return await readThrottleBlock(buildLoginThrottleInput(requestBody, sourceIp));
}

export async function recordFailedLoginAttempt(requestBody: LoginRequest, sourceIp: string): Promise<void> {
  await recordThrottleFailure(buildLoginThrottleInput(requestBody, sourceIp));
}

export async function clearSuccessfulLoginThrottle(requestBody: LoginRequest, sourceIp: string): Promise<void> {
  await clearThrottleBuckets(buildLoginThrottleInput(requestBody, sourceIp, loginThrottleResetBucketKinds));
}

function buildLoginThrottleInput(
  requestBody: LoginRequest,
  sourceIp: string,
  bucketKinds: readonly LoginThrottleBucketKind[] = loginThrottleBucketKinds,
): ThrottleActionInput {
  const identity: LoginThrottleIdentity = buildLoginThrottleIdentity(requestBody, sourceIp);

  return {
    action: loginThrottleAction,
    buckets: buildLoginThrottleBuckets(identity, bucketKinds),
    policies: buildLoginThrottlePolicies(getApiConfig().throttle.login),
    scope: authThrottleScope,
  };
}

function buildLoginThrottleBuckets(
  identity: LoginThrottleIdentity,
  bucketKinds: readonly LoginThrottleBucketKind[],
): readonly ThrottleBucketDescriptor[] {
  const bucketsByKind: Record<LoginThrottleBucketKind, string> = {
    account: identity.accountKey,
    source: identity.sourceKey,
    source_account: identity.sourceAccountKey,
  };

  return buildAuthThrottleBuckets(bucketKinds, bucketsByKind);
}

function buildLoginThrottlePolicies(config: ApiAuthLoginThrottleConfig): readonly ThrottleBucketPolicy[] {
  return buildAuthThrottlePolicies(loginThrottleBucketKinds, {
    account: config.account,
    source: config.source,
    source_account: config.sourceAccount,
  });
}
