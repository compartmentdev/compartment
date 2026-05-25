import type { ApiConfig } from '../config';
import type { PrincipalCredentialRow } from '../queries/organization-users.query.types';
import type { OrganizationRow } from '../queries/organizations.query.types';
import type { AuthSessionPlan, PasswordAuthResult } from './auth-session.types';

export type ResetPasswordResult = PasswordAuthResult;

export interface PasswordResetPlan {
  config: ApiConfig;
  email: string;
  newPassword: string;
  resetToken: string;
}

export interface PasswordResetTransactionResult {
  organizations: OrganizationRow[];
  principalEmail: string;
  principalId: string;
  revokedSessionIds: string[];
  session: AuthSessionPlan;
}

export interface PasswordResetValidationResult {
  organizations: OrganizationRow[];
  principal: PrincipalCredentialRow;
  sessionOrganizationId: string;
}

export interface PasswordResetScopeValidationResult {
  organizations: OrganizationRow[];
  sessionOrganizationId: string;
}
