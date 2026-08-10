import type { PasswordAuthResult } from './auth-session.types';

export interface SignupInput {
  email?: string | undefined;
  organizationName: string;
}

export type SignupResult = PasswordAuthResult;
