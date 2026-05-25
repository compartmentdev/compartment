import { browserLoginCliPathname } from '../browser-public-paths';
import { createInvalidCliLoginError, createInvalidCredentialsError } from '../errors/api-business-error';
import { createId, createToken, hashToken } from '../lib/tokens';
import { findCliLoginAttemptById } from '../queries/cli-login.query';
import type { CliLoginAttemptRow } from '../queries/cli-login.query.types';
import { listOrganizationRows, listOrganizationRowsForPrincipalEmail } from '../queries/organizations.query';
import type { OrganizationRow } from '../queries/organizations.query.types';
import { getApiConfig } from '../runtime/runtime-access';
import { requireMatchingOrganizationRow } from './organization-row-match.service.helpers';
import { buildRuntimePublicSettings } from './public-hosts.service';

type CliLoginAttemptSecretHashField = 'browserCodeHash' | 'exchangeSecretHash';

export interface CliLoginAttemptPlan {
  attemptId: string;
  browserCode: string;
  exchangeSecret: string;
  expectedPrincipalEmail: string | null;
  expiresAt: Date;
  organizationId: string | null;
}

export function createCliLoginAttemptPlan(
  email: string | undefined,
  now: Date,
  organizationId: string | undefined,
  ttlMs: number,
): CliLoginAttemptPlan {
  return {
    attemptId: createId('cla'),
    browserCode: createToken(),
    exchangeSecret: createToken(),
    expectedPrincipalEmail: email !== undefined ? normalizeCliLoginEmail(email) : null,
    expiresAt: new Date(now.getTime() + ttlMs),
    organizationId: organizationId ?? null,
  };
}

export function buildCliLoginVerificationUrl(attemptId: string, browserCode: string): string {
  const url: URL = new URL(browserLoginCliPathname, `${buildRuntimePublicSettings(getApiConfig()).compartmentUrl}/`);
  url.searchParams.set('attempt', attemptId);
  url.hash = new URLSearchParams({ code: browserCode }).toString();
  return url.toString();
}

export async function resolveCliLoginOrganization(
  email: string | undefined,
  organizationSlug: string | undefined,
): Promise<OrganizationRow | undefined> {
  if (email === undefined) {
    return await resolveCliLoginOrganizationWithoutEmail(organizationSlug);
  }

  return await resolveCliLoginOrganizationForEmail(email, organizationSlug);
}

async function resolveCliLoginOrganizationWithoutEmail(
  organizationSlug: string | undefined,
): Promise<OrganizationRow | undefined> {
  if (organizationSlug === undefined) {
    return undefined;
  }

  return requireMatchingOrganizationRow(await listOrganizationRows(), organizationSlug);
}

async function resolveCliLoginOrganizationForEmail(
  email: string,
  organizationSlug: string | undefined,
): Promise<OrganizationRow> {
  const organizations: OrganizationRow[] = await listOrganizationRowsForPrincipalEmail(email);
  if (organizations.length === 0) {
    throw createInvalidCredentialsError();
  }
  if (organizationSlug === undefined) {
    if (organizations.length !== 1) {
      throw createInvalidCredentialsError();
    }

    return organizations[0]!;
  }

  return requireMatchingOrganizationRow(organizations, organizationSlug);
}

export function requireExchangeableCliLoginAttempt(attempt: CliLoginAttemptRow, now: Date): CliLoginAttemptRow {
  if (
    attempt.expiresAt <= now ||
    attempt.exchangedAt !== null ||
    attempt.authenticatedPrincipalId === null ||
    attempt.authenticatedAt === null ||
    attempt.authenticatedAuthMethodKind === null ||
    (attempt.authenticatedAuthMethodKind === 'oidc' && attempt.authenticatedOidcProviderId === null)
  ) {
    throw createInvalidCliLoginError();
  }

  return attempt;
}

export async function requireCliLoginAttemptByExchangeSecret(
  attemptId: string,
  exchangeSecret: string,
): Promise<CliLoginAttemptRow> {
  return await requireCliLoginAttemptBySecretHash(attemptId, exchangeSecret, 'exchangeSecretHash');
}

export async function requireActiveCliLoginAttemptByBrowserCode(
  attemptId: string,
  browserCode: string,
): Promise<CliLoginAttemptRow> {
  const attempt: CliLoginAttemptRow = await requireCliLoginAttemptByBrowserCode(attemptId, browserCode);
  if (attempt.expiresAt <= new Date() || attempt.authenticatedAt !== null || attempt.exchangedAt !== null) {
    throw createInvalidCliLoginError();
  }

  return attempt;
}

export async function requireUnauthenticatedCliLoginAttemptById(attemptId: string): Promise<CliLoginAttemptRow> {
  const attempt: CliLoginAttemptRow | undefined = await findCliLoginAttemptById(attemptId);
  if (
    attempt === undefined ||
    attempt.expiresAt <= new Date() ||
    attempt.authenticatedAt !== null ||
    attempt.exchangedAt !== null
  ) {
    throw createInvalidCliLoginError();
  }

  return attempt;
}

async function requireCliLoginAttemptByBrowserCode(
  attemptId: string,
  browserCode: string,
): Promise<CliLoginAttemptRow> {
  return await requireCliLoginAttemptBySecretHash(attemptId, browserCode, 'browserCodeHash');
}

async function requireCliLoginAttemptBySecretHash(
  attemptId: string,
  secret: string,
  hashField: CliLoginAttemptSecretHashField,
): Promise<CliLoginAttemptRow> {
  const attempt: CliLoginAttemptRow | undefined = await findCliLoginAttemptById(attemptId);
  const expectedHash: string = hashCliLoginSecret(secret);
  if (attempt?.[hashField] !== expectedHash) {
    throw createInvalidCliLoginError();
  }

  return attempt;
}

export function normalizeCliLoginEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashCliLoginSecret(value: string): string {
  return hashToken(value, getApiConfig().sessionSecret);
}
