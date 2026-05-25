import type { ApiConfig } from '../config';
import { createId, createToken, hashToken } from '../lib/tokens';
import { createAuthSessionWithExecutor } from '../queries/authentication.query';
import type { CreateAuthSessionInput } from '../queries/authentication.query.types';
import type { OrganizationUsersTransaction } from '../queries/organization-users.query.types';
import type { AuthSessionPlan, IssueAuthSessionInput } from './auth-session.types';
import type { AuthSessionOrganizationPolicySession } from './organization-auth-settings.service.types';

export async function issueAuthSessionWithExecutor(
  tx: OrganizationUsersTransaction,
  input: IssueAuthSessionInput,
  config: ApiConfig,
): Promise<AuthSessionPlan> {
  const session: AuthSessionPlan = createAuthSessionPlan(input, config);
  await createAuthSessionWithExecutor(tx, buildCreateAuthSessionInput(session, input.principalId));
  return session;
}

export function createPasswordAuthSessionInput(
  principalId: string,
  organizationId: string | null,
): IssueAuthSessionInput {
  return {
    authMethodKind: 'password',
    oidcProviderId: null,
    organizationId,
    principalId,
  };
}

export function createScopedPasswordAuthSessionInput(
  principalId: string,
  organizationId: string,
): IssueAuthSessionInput {
  return {
    authMethodKind: 'password_scoped',
    oidcProviderId: null,
    organizationId,
    principalId,
  };
}

export function createAuthSessionPlan(input: IssueAuthSessionInput, config: ApiConfig): AuthSessionPlan {
  const sessionToken: string = createToken();

  return {
    authMethodKind: input.authMethodKind,
    expiresAt: createSessionExpirationTime(config),
    oidcProviderId: input.oidcProviderId,
    organizationId: input.organizationId,
    sessionId: createId('ses'),
    sessionToken,
    tokenHash: hashToken(sessionToken, config.sessionSecret),
  };
}

export function buildAuthSessionOrganizationPolicySession(
  session: AuthSessionPlan,
  principalId: string,
): AuthSessionOrganizationPolicySession {
  return {
    authMethodKind: session.authMethodKind,
    oidcProviderId: session.oidcProviderId,
    organizationId: session.organizationId,
    principalId,
  };
}

function createSessionExpirationTime(config: ApiConfig): Date {
  return new Date(Date.now() + config.sessionTtlMs);
}

function buildCreateAuthSessionInput(session: AuthSessionPlan, principalId: string): CreateAuthSessionInput {
  return {
    authMethodKind: session.authMethodKind,
    expiresAt: session.expiresAt,
    oidcProviderId: session.oidcProviderId,
    organizationId: session.organizationId,
    principalId,
    sessionId: session.sessionId,
    tokenHash: session.tokenHash,
  };
}
