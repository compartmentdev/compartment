import type { ThrottleBucketDescriptor, ThrottleBucketPolicy } from './throttle.service.types';

interface AuthThrottlePolicyValues {
  blockMs: number;
  maxFailures: number;
  windowMs: number;
}

export function buildAuthThrottleBuckets<TBucketKind extends string>(
  bucketKinds: readonly TBucketKind[],
  bucketsByKind: Record<TBucketKind, string>,
): readonly ThrottleBucketDescriptor[] {
  return bucketKinds.map(
    (bucketKind: TBucketKind): ThrottleBucketDescriptor => ({
      bucketKey: bucketsByKind[bucketKind],
      bucketKind,
    }),
  );
}

export function buildAuthThrottlePolicies<TBucketKind extends string>(
  bucketKinds: readonly TBucketKind[],
  policiesByKind: Record<TBucketKind, AuthThrottlePolicyValues>,
): readonly ThrottleBucketPolicy[] {
  return bucketKinds.map(
    (bucketKind: TBucketKind): ThrottleBucketPolicy => ({
      blockMs: policiesByKind[bucketKind].blockMs,
      bucketKind,
      maxFailures: policiesByKind[bucketKind].maxFailures,
      windowMs: policiesByKind[bucketKind].windowMs,
    }),
  );
}
