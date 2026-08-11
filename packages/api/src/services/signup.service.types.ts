import type { PasswordAuthResult } from './auth-session.types';

export interface SignupInput {
  email?: string | undefined;
  idempotencyKey: string;
  organizationName: string;
}

export interface SignupAccount {
  email: string;
  isNewAccount: boolean;
  principalId: string;
}

export type SignupResult = PasswordAuthResult;
