import type { ApiDatabaseTransaction } from '../db/client.types';

export interface SignupIdempotencyRecordRow {
  createdAt: Date;
  principalEmail: string;
  principalId: string;
  requestHash: string;
}

export interface StoreSignupIdempotencyKeyInput {
  id: string;
  keyHash: string;
  principalId: string;
  requestHash: string;
}

export type SignupIdempotencyTransaction = ApiDatabaseTransaction;
