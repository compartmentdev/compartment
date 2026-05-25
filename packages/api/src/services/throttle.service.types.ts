export interface ThrottleBucketDescriptor {
  bucketKey: string;
  bucketKind: string;
}

export interface ThrottleBucketPolicy {
  blockMs: number;
  bucketKind: string;
  maxFailures: number;
  windowMs: number;
}

export interface ThrottleActionInput {
  action: string;
  buckets: readonly ThrottleBucketDescriptor[];
  policies: readonly ThrottleBucketPolicy[];
  scope: string;
}

export interface ThrottleBlock {
  retryAfterSeconds: number;
}
