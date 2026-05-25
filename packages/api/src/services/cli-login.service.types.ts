import type { AuthSessionMethodKind } from '../queries/authentication.query.types';
import type { OrganizationRow } from '../queries/organizations.query.types';

export interface StartCliLoginInput {
  email?: string | undefined;
  onboardingSessionId?: string | undefined;
  organizationSlug?: string | undefined;
}

export interface CliLoginStartResult {
  attemptId: string;
  exchangeSecret: string;
  expiresAt: Date;
  pollAfterMs: number;
  verificationUrl: string;
}

export interface CliLoginSecretInput {
  attemptId: string;
  exchangeSecret: string;
}

export interface StartCliBrowserLoginInput {
  attemptId: string;
  browserCode: string;
}

export interface CliBrowserLoginAttempt {
  authenticatedAt: Date | null;
  authenticatedPrincipalId: string | null;
  expectedPrincipalEmail?: string | undefined;
  expiresAt: Date;
  id: string;
  organizationSlug?: string | undefined;
}

export interface CliLoginSessionActor {
  authMethodKind: AuthSessionMethodKind;
  oidcProviderId: string | null;
  organizationId: string | null;
  principalEmail: string;
  principalId: string;
}

export interface CompleteCliLoginAttemptFromSessionInput {
  attemptId: string;
  browserCode: string;
  session: CliLoginSessionActor;
}

export interface CompleteCliLoginAttemptFromAuthenticatedSessionInput {
  attemptId: string;
  session: CliLoginSessionActor;
}

export interface CliLoginPendingStatusResult {
  expiresAt: Date;
  status: 'pending';
}

export interface CliLoginAuthenticatedStatusResult {
  expiresAt: Date;
  status: 'authenticated';
}

export interface CliLoginExpiredStatusResult {
  expiresAt: Date;
  status: 'expired';
}

export interface CliLoginExchangedStatusResult {
  expiresAt: Date;
  status: 'exchanged';
}

export type CliLoginStatusResult =
  | CliLoginPendingStatusResult
  | CliLoginAuthenticatedStatusResult
  | CliLoginExpiredStatusResult
  | CliLoginExchangedStatusResult;

export interface CliLoginExchangeResult {
  organizations: OrganizationRow[];
  principalEmail: string;
  principalId: string;
  sessionExpiresAt: Date;
  sessionId: string;
  sessionToken: string;
}
