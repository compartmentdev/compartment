import { createInvalidCliLoginError } from '../errors/api-business-error';
import {
  expireCliLoginAttempt,
  markCliLoginAttemptAuthenticated,
  markCliLoginAttemptExchangedWithExecutor,
} from '../queries/cli-login.query';
import type { AuthSessionMethodKind } from '../queries/authentication.query.types';
import { createAuthSessionWithExecutor } from '../queries/authentication.query';
import type { CliLoginAttemptExecutor, CliLoginAttemptRow } from '../queries/cli-login.query.types';
import { findPrincipalEmailById } from '../queries/principal.query';
import { findOrganizationById } from '../queries/organizations.query';
import type { OrganizationRow } from '../queries/organizations.query.types';
import { getApiConfig, getApiDatabase } from '../runtime/runtime-access';
import { persistCliLoginAttemptPlan } from './cli-login-attempt-persistence.service';
import { readValidatedCliLoginOnboardingSessionId } from './cli-login-onboarding.service';
import { buildAuthSessionOrganizationPolicySession, createAuthSessionPlan } from './auth-session.service';
import type { AuthSessionPlan } from './auth-session.types';
import { isAuthSessionAllowedForOrganization } from './organization-auth-settings.service';
import { listSessionVisibleOrganizations } from './organizations.service';
import {
  buildCliLoginVerificationUrl,
  createCliLoginAttemptPlan,
  normalizeCliLoginEmail,
  requireActiveCliLoginAttemptByBrowserCode,
  requireCliLoginAttemptByExchangeSecret,
  requireExchangeableCliLoginAttempt,
  requireUnauthenticatedCliLoginAttemptById,
  resolveCliLoginOrganization,
  type CliLoginAttemptPlan,
} from './cli-login.service.helpers';
import type {
  CliBrowserLoginAttempt,
  CliLoginExchangeResult,
  CliLoginSecretInput,
  CliLoginSessionActor,
  CliLoginStartResult,
  CliLoginStatusResult,
  CompleteCliLoginAttemptFromAuthenticatedSessionInput,
  CompleteCliLoginAttemptFromSessionInput,
  StartCliBrowserLoginInput,
  StartCliLoginInput,
} from './cli-login.service.types';

const cliLoginAttemptTtlMs: number = 10 * 60 * 1000;
const cliLoginPollAfterMs: number = 2_000;

export async function startCliLogin(input: StartCliLoginInput): Promise<CliLoginStartResult> {
  const now: Date = new Date();
  const organization: OrganizationRow | undefined = await resolveCliLoginOrganization(
    input.email,
    input.organizationSlug,
  );
  const onboardingSessionId: string | null = await readValidatedCliLoginOnboardingSessionId(
    input.onboardingSessionId,
    input.email,
    organization,
  );
  const plan: CliLoginAttemptPlan = createCliLoginAttemptPlan(input.email, now, organization?.id, cliLoginAttemptTtlMs);

  await persistCliLoginAttemptPlan(plan, now, onboardingSessionId);

  return {
    attemptId: plan.attemptId,
    exchangeSecret: plan.exchangeSecret,
    expiresAt: plan.expiresAt,
    pollAfterMs: cliLoginPollAfterMs,
    verificationUrl: buildCliLoginVerificationUrl(plan.attemptId, plan.browserCode),
  };
}

export async function startCliBrowserLogin(input: StartCliBrowserLoginInput): Promise<CliBrowserLoginAttempt> {
  const attempt: CliLoginAttemptRow = await requireActiveCliLoginAttemptByBrowserCode(
    input.attemptId,
    input.browserCode,
  );
  let organizationSlug: string | undefined;
  if (attempt.organizationId !== null) {
    const organization: OrganizationRow | undefined = await findOrganizationById(attempt.organizationId);
    if (organization === undefined) {
      throw createInvalidCliLoginError();
    }
    organizationSlug = organization.slug;
  }

  return toCliBrowserLoginAttempt(attempt, organizationSlug);
}

export async function getCliLoginStatus(input: CliLoginSecretInput): Promise<CliLoginStatusResult> {
  const attempt: CliLoginAttemptRow = await requireCliLoginAttemptByExchangeSecret(
    input.attemptId,
    input.exchangeSecret,
  );
  const now: Date = new Date();

  if (attempt.exchangedAt !== null) {
    return { expiresAt: attempt.expiresAt, status: 'exchanged' };
  }
  if (attempt.expiresAt <= now) {
    return { expiresAt: attempt.expiresAt, status: 'expired' };
  }
  if (attempt.authenticatedAt !== null) {
    return { expiresAt: attempt.expiresAt, status: 'authenticated' };
  }

  return { expiresAt: attempt.expiresAt, status: 'pending' };
}

export async function exchangeCliLogin(input: CliLoginSecretInput): Promise<CliLoginExchangeResult> {
  const attempt: CliLoginAttemptRow = await requireCliLoginAttemptByExchangeSecret(
    input.attemptId,
    input.exchangeSecret,
  );
  const now: Date = new Date();
  const exchangeableAttempt: CliLoginAttemptRow = requireExchangeableCliLoginAttempt(attempt, now);
  const principalId: string = exchangeableAttempt.authenticatedPrincipalId ?? failMissingCliLoginState();
  const session: AuthSessionPlan = createCliLoginAuthSession(exchangeableAttempt, principalId);

  await persistCliLoginExchange(exchangeableAttempt.id, principalId, now, session);

  return await buildCliLoginExchangeResult(exchangeableAttempt, principalId, session);
}

export async function completeCliLoginAttemptFromSession(
  input: CompleteCliLoginAttemptFromSessionInput,
): Promise<void> {
  const attempt: CliLoginAttemptRow = await requireActiveCliLoginAttemptByBrowserCode(
    input.attemptId,
    input.browserCode,
  );
  await completeCliLoginAttemptWithSession(attempt, input.session);
}

export async function completeCliLoginAttemptFromAuthenticatedSession(
  input: CompleteCliLoginAttemptFromAuthenticatedSessionInput,
): Promise<void> {
  const attempt: CliLoginAttemptRow = await requireUnauthenticatedCliLoginAttemptById(input.attemptId);
  await completeCliLoginAttemptWithSession(attempt, input.session);
}

export async function failCliLoginAttempt(attemptId: string): Promise<void> {
  await expireCliLoginAttempt(attemptId, new Date());
}

function createCliLoginAuthSession(attempt: CliLoginAttemptRow, principalId: string): AuthSessionPlan {
  const authMethodKind: AuthSessionMethodKind = attempt.authenticatedAuthMethodKind ?? failMissingCliLoginState();

  return createAuthSessionPlan(
    {
      authMethodKind,
      oidcProviderId: attempt.authenticatedOidcProviderId,
      organizationId: attempt.organizationId,
      principalId,
    },
    getApiConfig(),
  );
}

async function persistCliLoginExchange(
  attemptId: string,
  principalId: string,
  exchangedAt: Date,
  session: AuthSessionPlan,
): Promise<void> {
  await getApiDatabase().transaction(async (transaction: CliLoginAttemptExecutor): Promise<void> => {
    if (!(await markCliLoginAttemptExchangedWithExecutor(transaction, attemptId, exchangedAt))) {
      throw createInvalidCliLoginError();
    }

    await createAuthSessionWithExecutor(transaction, {
      authMethodKind: session.authMethodKind,
      expiresAt: session.expiresAt,
      oidcProviderId: session.oidcProviderId,
      organizationId: session.organizationId,
      principalId,
      sessionId: session.sessionId,
      tokenHash: session.tokenHash,
    });
  });
}

async function buildCliLoginExchangeResult(
  attempt: CliLoginAttemptRow,
  principalId: string,
  session: AuthSessionPlan,
): Promise<CliLoginExchangeResult> {
  return {
    organizations: await listSessionVisibleOrganizations(
      buildAuthSessionOrganizationPolicySession(session, principalId),
    ),
    principalEmail: await readCliLoginExchangePrincipalEmail(attempt, principalId),
    principalId,
    sessionExpiresAt: session.expiresAt,
    sessionId: session.sessionId,
    sessionToken: session.sessionToken,
  };
}

async function readCliLoginExchangePrincipalEmail(attempt: CliLoginAttemptRow, principalId: string): Promise<string> {
  if (attempt.expectedPrincipalEmail !== null) {
    return attempt.expectedPrincipalEmail;
  }

  const principalEmail: string | undefined = await findPrincipalEmailById(principalId);
  if (principalEmail === undefined) {
    throw createInvalidCliLoginError();
  }

  return principalEmail;
}

async function completeCliLoginAttemptWithSession(
  attempt: CliLoginAttemptRow,
  session: CliLoginSessionActor,
): Promise<void> {
  await assertCliLoginSessionMatchesAttempt(attempt, session);
  if (
    !(await markCliLoginAttemptAuthenticated(
      attempt.id,
      attempt.organizationId ?? session.organizationId,
      session.principalId,
      session.authMethodKind,
      session.oidcProviderId,
      new Date(),
    ))
  ) {
    throw createInvalidCliLoginError();
  }
}

function failMissingCliLoginState(): never {
  throw createInvalidCliLoginError();
}

async function assertCliLoginSessionMatchesAttempt(
  attempt: CliLoginAttemptRow,
  session: CliLoginSessionActor,
): Promise<void> {
  if (
    attempt.expectedPrincipalEmail !== null &&
    normalizeCliLoginEmail(session.principalEmail) !== attempt.expectedPrincipalEmail
  ) {
    throw createInvalidCliLoginError();
  }
  if (
    attempt.organizationId !== null &&
    !(await isAuthSessionAllowedForOrganization({
      organizationId: attempt.organizationId,
      session,
    }))
  ) {
    throw createInvalidCliLoginError();
  }
}

function toCliBrowserLoginAttempt(
  attempt: CliLoginAttemptRow,
  organizationSlug: string | undefined,
): CliBrowserLoginAttempt {
  return {
    authenticatedAt: attempt.authenticatedAt,
    authenticatedPrincipalId: attempt.authenticatedPrincipalId,
    ...(attempt.expectedPrincipalEmail !== null ? { expectedPrincipalEmail: attempt.expectedPrincipalEmail } : {}),
    expiresAt: attempt.expiresAt,
    id: attempt.id,
    ...(organizationSlug !== undefined ? { organizationSlug } : {}),
  };
}
