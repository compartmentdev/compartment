import type { Database } from '../db/client';

export type AuthSessionMethodKind = 'oidc' | 'password' | 'password_scoped';

export interface AuthenticationSessionRow {
  authMethodKind: AuthSessionMethodKind;
  oidcProviderId: string | null;
  organizationId: string | null;
  principalEmail: string;
  principalId: string;
  principalType: string;
  sessionId: string;
}

export interface AuthSessionActorRow extends AuthenticationSessionRow {
  expiresAt: Date;
}

export interface CreateAuthSessionInput {
  authMethodKind: AuthSessionMethodKind;
  expiresAt: Date;
  oidcProviderId: string | null;
  organizationId: string | null;
  principalId: string;
  sessionId: string;
  tokenHash: string;
}

export interface ListActiveAuthenticationSessionIdsByOidcProviderInput {
  oidcProviderId: string;
  organizationId: string;
}

export interface RevokeActivePasswordSessionsByOrganizationInput {
  organizationId: string;
  revokedAt: Date;
}

export type AuthenticationQueryExecutor = Pick<Database, 'insert' | 'select' | 'update'>;
