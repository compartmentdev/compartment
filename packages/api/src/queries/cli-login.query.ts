import { and, desc, eq, gt, isNotNull, isNull, lte, notExists, or, type SQL } from 'drizzle-orm';
import { cliLoginAttempts, ssoOidcFlows } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type { CliLoginAttemptExecutor, CliLoginAttemptRow, CreateCliLoginAttemptInput } from './cli-login.query.types';
import type { AuthSessionMethodKind } from './authentication.query.types';

interface PersistedCliLoginAttemptRow extends Omit<CliLoginAttemptRow, 'authenticatedAuthMethodKind'> {
  authenticatedAuthMethodKind: string | null;
}

export async function deleteStaleCliLoginAttempts(now: Date): Promise<void> {
  const db: CliLoginAttemptExecutor = getApiDatabase();

  await db
    .delete(cliLoginAttempts)
    .where(
      or(
        and(
          lte(cliLoginAttempts.expiresAt, now),
          notExists(
            db
              .select({ id: ssoOidcFlows.id })
              .from(ssoOidcFlows)
              .where(eq(ssoOidcFlows.cliLoginAttemptId, cliLoginAttempts.id)),
          ),
        ),
        isNotNull(cliLoginAttempts.exchangedAt),
      ),
    );
}

export async function createCliLoginAttempt(input: CreateCliLoginAttemptInput): Promise<void> {
  await getApiDatabase().insert(cliLoginAttempts).values(input);
}

export async function findCliLoginAttemptById(attemptId: string): Promise<CliLoginAttemptRow | undefined> {
  const rows: PersistedCliLoginAttemptRow[] = await getApiDatabase()
    .select()
    .from(cliLoginAttempts)
    .where(eq(cliLoginAttempts.id, attemptId))
    .limit(1);

  return rows[0] === undefined ? undefined : mapCliLoginAttemptRow(rows[0]);
}

export async function findLatestCliLoginAttemptByOnboardingSessionId(
  onboardingSessionId: string,
  organizationId: string,
): Promise<CliLoginAttemptRow | undefined> {
  const rows: PersistedCliLoginAttemptRow[] = await getApiDatabase()
    .select()
    .from(cliLoginAttempts)
    .where(
      and(
        eq(cliLoginAttempts.onboardingSessionId, onboardingSessionId),
        eq(cliLoginAttempts.organizationId, organizationId),
      ),
    )
    .orderBy(desc(cliLoginAttempts.createdAt), desc(cliLoginAttempts.id))
    .limit(1);

  return rows[0] === undefined ? undefined : mapCliLoginAttemptRow(rows[0]);
}

export async function markCliLoginAttemptAuthenticated(
  attemptId: string,
  organizationId: string | null,
  principalId: string,
  authMethodKind: AuthSessionMethodKind,
  oidcProviderId: string | null,
  authenticatedAt: Date,
): Promise<boolean> {
  const rows: { id: string }[] = await getApiDatabase()
    .update(cliLoginAttempts)
    .set(
      buildAuthenticatedCliLoginAttemptFields(
        organizationId,
        principalId,
        authMethodKind,
        oidcProviderId,
        authenticatedAt,
      ),
    )
    .where(buildMarkAuthenticatedCliLoginAttemptWhere(attemptId, authenticatedAt))
    .returning({ id: cliLoginAttempts.id });

  return rows.length > 0;
}

export async function markCliLoginAttemptExchangedWithExecutor(
  executor: CliLoginAttemptExecutor,
  attemptId: string,
  exchangedAt: Date,
): Promise<boolean> {
  const rows: { id: string }[] = await executor
    .update(cliLoginAttempts)
    .set({ exchangedAt })
    .where(
      and(
        eq(cliLoginAttempts.id, attemptId),
        isNotNull(cliLoginAttempts.authenticatedAt),
        isNull(cliLoginAttempts.exchangedAt),
        gt(cliLoginAttempts.expiresAt, exchangedAt),
      ),
    )
    .returning({ id: cliLoginAttempts.id });

  return rows.length > 0;
}

export async function expireCliLoginAttempt(attemptId: string, expiredAt: Date): Promise<boolean> {
  const rows: { id: string }[] = await getApiDatabase()
    .update(cliLoginAttempts)
    .set({ expiresAt: expiredAt })
    .where(
      and(
        eq(cliLoginAttempts.id, attemptId),
        isNull(cliLoginAttempts.authenticatedAt),
        isNull(cliLoginAttempts.exchangedAt),
        gt(cliLoginAttempts.expiresAt, expiredAt),
      ),
    )
    .returning({ id: cliLoginAttempts.id });

  return rows.length > 0;
}

function mapCliLoginAttemptRow(row: PersistedCliLoginAttemptRow): CliLoginAttemptRow {
  return {
    ...row,
    authenticatedAuthMethodKind: readAuthSessionMethodKind(row.authenticatedAuthMethodKind),
  };
}

function readAuthSessionMethodKind(value: string | null): AuthSessionMethodKind | null {
  if (value === null || value === 'oidc' || value === 'password' || value === 'password_scoped') {
    return value;
  }

  throw new Error(`Unexpected CLI login auth method kind ${value}.`);
}

function buildAuthenticatedCliLoginAttemptFields(
  organizationId: string | null,
  principalId: string,
  authMethodKind: AuthSessionMethodKind,
  oidcProviderId: string | null,
  authenticatedAt: Date,
): {
  authenticatedAt: Date;
  authenticatedAuthMethodKind: AuthSessionMethodKind;
  authenticatedOidcProviderId: string | null;
  authenticatedPrincipalId: string;
  organizationId: string | null;
} {
  return {
    authenticatedAt,
    authenticatedAuthMethodKind: authMethodKind,
    authenticatedOidcProviderId: oidcProviderId,
    authenticatedPrincipalId: principalId,
    organizationId,
  };
}

function buildMarkAuthenticatedCliLoginAttemptWhere(attemptId: string, authenticatedAt: Date): SQL {
  const whereClause: SQL | undefined = and(
    eq(cliLoginAttempts.id, attemptId),
    isNull(cliLoginAttempts.authenticatedAt),
    isNull(cliLoginAttempts.exchangedAt),
    gt(cliLoginAttempts.expiresAt, authenticatedAt),
  );

  if (whereClause === undefined) {
    throw new Error('Expected a CLI login authentication predicate.');
  }

  return whereClause;
}
