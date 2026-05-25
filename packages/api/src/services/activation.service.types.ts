import type { PasswordAuthResult } from './auth-session.types';

export interface ActivateLocalUserInput {
  bootstrapToken: string;
  email: string;
  password: string;
}

export type ActivateLocalUserResult = PasswordAuthResult;
