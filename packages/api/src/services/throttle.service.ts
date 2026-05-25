import { scrypt } from 'node:crypto';
import {
  deleteExpiredThrottleBuckets,
  deleteThrottleBuckets,
  findBlockingThrottleBuckets,
  findThrottleBucketForUpdateWithExecutor,
  tryInsertThrottleBucketWithExecutor,
  updateThrottleBucketWithExecutor,
} from '../queries/throttle.query';
import type {
  ThrottleBucketIdentity,
  ThrottleBucketRow,
  ThrottleBucketsTransaction,
  ThrottleBucketWindowPolicy,
  UpdateThrottleBucketInput,
} from '../queries/throttle.query.types';
import { getApiConfig, getApiDatabase } from '../runtime/runtime-access';
import type {
  ThrottleActionInput,
  ThrottleBlock,
  ThrottleBucketDescriptor,
  ThrottleBucketPolicy,
} from './throttle.service.types';

export async function readThrottleBlock(input: ThrottleActionInput): Promise<ThrottleBlock | null> {
  const now: Date = new Date();
  const identities: readonly ThrottleBucketIdentity[] = await buildThrottleBucketIdentities(input);

  await deleteExpiredThrottleBuckets(input.scope, input.action, buildWindowPolicies(input.policies), now);

  const blockingBuckets: ThrottleBucketRow[] = await findBlockingThrottleBuckets(
    input.scope,
    input.action,
    identities.map((identity: ThrottleBucketIdentity): string => identity.bucketKeyHash),
    now,
  );

  if (blockingBuckets.length === 0) {
    return null;
  }

  return {
    retryAfterSeconds: blockingBuckets.reduce(
      (maxSeconds: number, bucket: ThrottleBucketRow): number =>
        Math.max(maxSeconds, readRetryAfterSeconds(bucket.blockedUntilAt, now)),
      1,
    ),
  };
}

export async function recordThrottleFailure(input: ThrottleActionInput): Promise<void> {
  const now: Date = new Date();
  const identities: readonly ThrottleBucketIdentity[] = await buildThrottleBucketIdentities(input);
  const policyMap: ReadonlyMap<string, ThrottleBucketPolicy> = buildThrottlePolicyMap(input.policies);

  await getApiDatabase().transaction(
    async (tx: ThrottleBucketsTransaction): Promise<void> =>
      await recordThrottleFailureWithExecutor(tx, identities, policyMap, now),
  );

  await deleteExpiredThrottleBuckets(input.scope, input.action, buildWindowPolicies(input.policies), now);
}

export async function clearThrottleBuckets(input: ThrottleActionInput): Promise<void> {
  const now: Date = new Date();
  const identities: readonly ThrottleBucketIdentity[] = await buildThrottleBucketIdentities(input);

  await deleteThrottleBuckets(
    input.scope,
    input.action,
    identities.map((identity: ThrottleBucketIdentity): string => identity.bucketKeyHash),
  );
  await deleteExpiredThrottleBuckets(input.scope, input.action, buildWindowPolicies(input.policies), now);
}

async function recordThrottleFailureWithExecutor(
  tx: ThrottleBucketsTransaction,
  identities: readonly ThrottleBucketIdentity[],
  policyMap: ReadonlyMap<string, ThrottleBucketPolicy>,
  now: Date,
): Promise<void> {
  for (const identity of identities) {
    await upsertThrottleBucketFailure(tx, identity, requireThrottlePolicy(policyMap, identity.bucketKind), now);
  }
}

async function upsertThrottleBucketFailure(
  tx: ThrottleBucketsTransaction,
  identity: ThrottleBucketIdentity,
  policy: ThrottleBucketPolicy,
  now: Date,
): Promise<void> {
  for (;;) {
    const current: ThrottleBucketRow | undefined = await findThrottleBucketForUpdateWithExecutor(tx, identity);
    if (current !== undefined) {
      await updateThrottleBucketWithExecutor(tx, buildFailureUpdateInput(current, identity, policy, now));
      return;
    }

    if (await tryInsertThrottleBucketFailure(tx, identity, policy, now)) {
      return;
    }
  }
}

async function tryInsertThrottleBucketFailure(
  tx: ThrottleBucketsTransaction,
  identity: ThrottleBucketIdentity,
  policy: ThrottleBucketPolicy,
  now: Date,
): Promise<boolean> {
  return await tryInsertThrottleBucketWithExecutor(tx, {
    action: identity.action,
    attemptCount: 1,
    blockedUntilAt: policy.maxFailures <= 1 ? addMs(now, policy.blockMs) : null,
    bucketKeyHash: identity.bucketKeyHash,
    bucketKind: identity.bucketKind,
    createdAt: now,
    scope: identity.scope,
    updatedAt: now,
    windowStartedAt: now,
  });
}

function buildFailureUpdateInput(
  current: ThrottleBucketRow,
  identity: ThrottleBucketIdentity,
  policy: ThrottleBucketPolicy,
  now: Date,
): UpdateThrottleBucketInput {
  const nowMs: number = now.getTime();
  const hasActiveBlock: boolean = current.blockedUntilAt !== null && current.blockedUntilAt.getTime() > nowMs;
  const shouldResetWindow: boolean = !hasActiveBlock && current.windowStartedAt.getTime() + policy.windowMs <= nowMs;
  const attemptCount: number = shouldResetWindow ? 1 : current.attemptCount + 1;

  return {
    attemptCount,
    blockedUntilAt: hasActiveBlock || attemptCount >= policy.maxFailures ? addMs(now, policy.blockMs) : null,
    identity,
    updatedAt: now,
    windowStartedAt: shouldResetWindow ? now : current.windowStartedAt,
  };
}

async function buildThrottleBucketIdentities(input: ThrottleActionInput): Promise<readonly ThrottleBucketIdentity[]> {
  return await Promise.all(
    input.buckets.map(
      async (bucket: ThrottleBucketDescriptor): Promise<ThrottleBucketIdentity> => ({
        action: input.action,
        bucketKeyHash: await createThrottleBucketKeyHash(
          buildThrottleBucketHashInput(input.scope, input.action, bucket),
          getApiConfig().sessionSecret,
        ),
        bucketKind: bucket.bucketKind,
        scope: input.scope,
      }),
    ),
  );
}

function buildThrottlePolicyMap(policies: readonly ThrottleBucketPolicy[]): ReadonlyMap<string, ThrottleBucketPolicy> {
  return new Map<string, ThrottleBucketPolicy>(
    policies.map((policy: ThrottleBucketPolicy): [string, ThrottleBucketPolicy] => [policy.bucketKind, policy]),
  );
}

function requireThrottlePolicy(
  policies: ReadonlyMap<string, ThrottleBucketPolicy>,
  bucketKind: string,
): ThrottleBucketPolicy {
  const policy: ThrottleBucketPolicy | undefined = policies.get(bucketKind);
  if (policy !== undefined) {
    return policy;
  }

  throw new Error(`Missing throttle policy for bucket kind ${bucketKind}.`);
}

function buildWindowPolicies(policies: readonly ThrottleBucketPolicy[]): readonly ThrottleBucketWindowPolicy[] {
  return policies.map(
    (policy: ThrottleBucketPolicy): ThrottleBucketWindowPolicy => ({
      bucketKind: policy.bucketKind,
      windowMs: policy.windowMs,
    }),
  );
}

function buildThrottleBucketHashInput(scope: string, action: string, bucket: ThrottleBucketDescriptor): string {
  return `${scope}:${action}:${bucket.bucketKind}:${bucket.bucketKey}`;
}

async function createThrottleBucketKeyHash(value: string, secret: string): Promise<string> {
  const derivedKey: Buffer<ArrayBufferLike> = await new Promise(
    (resolve: (value: Buffer<ArrayBufferLike>) => void, reject: (error: Error) => void): void => {
      scrypt(value, secret, 32, (error: Error | null, key: Buffer<ArrayBufferLike>): void => {
        if (error !== null) {
          reject(error);
          return;
        }

        resolve(key);
      });
    },
  );

  return derivedKey.toString('hex');
}

function readRetryAfterSeconds(blockedUntilAt: Date | null, now: Date): number {
  if (blockedUntilAt === null) {
    return 1;
  }

  return Math.max(1, Math.ceil((blockedUntilAt.getTime() - now.getTime()) / 1000));
}

function addMs(value: Date, durationMs: number): Date {
  return new Date(value.getTime() + durationMs);
}
