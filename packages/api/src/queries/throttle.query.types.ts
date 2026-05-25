import type { ApiDatabaseTransaction } from '../db/client.types';

export type ThrottleBucketTimestampValue = Date | number | string;

export interface ThrottleBucketIdentity {
  action: string;
  bucketKeyHash: string;
  bucketKind: string;
  scope: string;
}

export interface ThrottleBucketRow {
  action: string;
  attemptCount: number;
  blockedUntilAt: Date | null;
  bucketKeyHash: string;
  bucketKind: string;
  createdAt: Date;
  scope: string;
  updatedAt: Date;
  windowStartedAt: Date;
}

export interface PersistedThrottleBucketRow {
  action: string;
  attemptCount: number;
  blockedUntilAt: ThrottleBucketTimestampValue | null;
  bucketKeyHash: string;
  bucketKind: string;
  createdAt: ThrottleBucketTimestampValue;
  scope: string;
  updatedAt: ThrottleBucketTimestampValue;
  windowStartedAt: ThrottleBucketTimestampValue;
}

export interface InsertThrottleBucketInput extends ThrottleBucketIdentity {
  attemptCount: number;
  blockedUntilAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  windowStartedAt: Date;
}

export interface UpdateThrottleBucketInput {
  attemptCount: number;
  blockedUntilAt: Date | null;
  identity: ThrottleBucketIdentity;
  updatedAt: Date;
  windowStartedAt: Date;
}

export interface ThrottleBucketWindowPolicy {
  bucketKind: string;
  windowMs: number;
}

export type ThrottleBucketsTransaction = ApiDatabaseTransaction;
