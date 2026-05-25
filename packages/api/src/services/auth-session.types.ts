import type { OrganizationRow } from '../queries/organizations.query.types';
import type { AuthSessionMethodKind } from '../queries/authentication.query.types';
import type { AuthSessionOrganizationPolicySession } from './organization-auth-settings.service.types';

export interface IssueAuthSessionInput {
  authMethodKind: AuthSessionMethodKind;
  oidcProviderId: string | null;
  organizationId: string | null;
  principalId: string;
}

export interface AuthSessionPlan {
  authMethodKind: AuthSessionMethodKind;
  expiresAt: Date;
  oidcProviderId: string | null;
  organizationId: string | null;
  sessionId: string;
  sessionToken: string;
  tokenHash: string;
}

export interface PasswordAuthResult {
  authSession: AuthSessionOrganizationPolicySession;
  organizations: OrganizationRow[];
  principalEmail: string;
  principalId: string;
  sessionExpiresAt: Date;
  sessionId: string;
  sessionToken: string;
}
