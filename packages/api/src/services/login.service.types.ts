import type { PasswordAuthResult } from './auth-session.types';

export interface LoginServiceInput {
  email: string;
  password: string;
}

export interface OrganizationLoginServiceInput extends LoginServiceInput {
  organizationId: string;
}

export type LoginServiceResult = PasswordAuthResult;
