import { and, eq, gt, inArray, isNull, type SQL } from 'drizzle-orm';
import type { SelectedFields } from 'drizzle-orm/pg-core/query-builders/select.types';
import { authSessions, principals } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type {
  AuthSessionActorRow,
  AuthSessionMethodKind,
  AuthenticationQueryExecutor,
  AuthenticationSessionRow,
  CreateAuthSessionInput,
  ListActiveAuthenticationSessionIdsByOidcProviderInput,
  RevokeActivePasswordSessionsByOrganizationInput,
} from './authentication.query.types';

interface PersistedAuthenticationSessionRow {
  authMethodKind: string;
  oidcProviderId: string | null;
  organizationId: string | null;
  principalEmail: string;
  principalId: string;
  principalType: string;
  sessionId: string;
}

interface PersistedAuthSessionActorRow extends PersistedAuthenticationSessionRow {
  expiresAt: Date;
}

interface PersistedAuthenticationSessionSelection extends SelectedFields {
  authMethodKind: typeof authSessions.authMethodKind;
  oidcProviderId: typeof authSessions.oidcProviderId;
  organizationId: typeof authSessions.organizationId;
  principalEmail: typeof principals.email;
  principalId: typeof principals.id;
  principalType: typeof principals.type;
  sessionId: typeof authSessions.id;
}

export async function findAuthenticationSessionByTokenHash(
  tokenHash: string,
): Promise<AuthenticationSessionRow | undefined> {
  const rows: PersistedAuthenticationSessionRow[] = await getApiDatabase()
    .select(persistedAuthenticationSessionSelection)
    .from(authSessions)
    .innerJoin(principals, eq(authSessions.principalId, principals.id))
    .where(buildActiveAuthenticationSessionWhere(eq(authSessions.tokenHash, tokenHash)));

  return rows[0] === undefined ? undefined : mapAuthenticationSessionRow(rows[0]);
}

export async function findActiveAuthenticationSessionById(sessionId: string): Promise<AuthSessionActorRow | undefined> {
  const rows: PersistedAuthSessionActorRow[] = await getApiDatabase()
    .select({
      ...persistedAuthenticationSessionSelection,
      expiresAt: authSessions.expiresAt,
    })
    .from(authSessions)
    .innerJoin(principals, eq(authSessions.principalId, principals.id))
    .where(buildActiveAuthenticationSessionWhere(eq(authSessions.id, sessionId)))
    .limit(1);

  return rows[0] === undefined ? undefined : mapAuthSessionActorRow(rows[0]);
}

export async function revokeSession(sessionId: string, revokedAt: Date): Promise<void> {
  await getApiDatabase().update(authSessions).set({ revokedAt }).where(eq(authSessions.id, sessionId));
}

export async function revokeActiveAuthenticationSessionsByPrincipalIdWithExecutor(
  executor: AuthenticationQueryExecutor,
  principalId: string,
  revokedAt: Date,
): Promise<string[]> {
  const rows: { sessionId: string }[] = await executor
    .update(authSessions)
    .set({ revokedAt })
    .where(buildActiveAuthenticationSessionWhere(eq(authSessions.principalId, principalId), revokedAt))
    .returning({
      sessionId: authSessions.id,
    });

  return rows.map((row: { sessionId: string }): string => row.sessionId);
}

export async function revokeActivePasswordSessionsByOrganization(
  input: RevokeActivePasswordSessionsByOrganizationInput,
): Promise<string[]> {
  return await revokeActiveAuthenticationSessions(
    and(
      eq(authSessions.organizationId, input.organizationId),
      inArray(authSessions.authMethodKind, ['password', 'password_scoped']),
    )!,
    input.revokedAt,
  );
}

export async function listActiveAuthenticationSessionIdsByOidcProvider(
  input: ListActiveAuthenticationSessionIdsByOidcProviderInput,
): Promise<string[]> {
  const rows: { id: string }[] = await getApiDatabase()
    .select({ id: authSessions.id })
    .from(authSessions)
    .where(
      buildActiveAuthenticationSessionWhere(
        and(
          eq(authSessions.authMethodKind, 'oidc'),
          eq(authSessions.oidcProviderId, input.oidcProviderId),
          eq(authSessions.organizationId, input.organizationId),
        )!,
      ),
    );

  return rows.map((row: { id: string }): string => row.id);
}

export async function createAuthSessionWithExecutor(
  executor: AuthenticationQueryExecutor,
  {
    authMethodKind,
    expiresAt,
    oidcProviderId,
    organizationId,
    principalId,
    sessionId,
    tokenHash,
  }: CreateAuthSessionInput,
): Promise<void> {
  await executor.insert(authSessions).values({
    authMethodKind,
    expiresAt,
    id: sessionId,
    oidcProviderId,
    organizationId,
    principalId,
    tokenHash,
  });
}

async function revokeActiveAuthenticationSessions(where: SQL, revokedAt: Date): Promise<string[]> {
  const rows: { id: string }[] = await getApiDatabase()
    .update(authSessions)
    .set({ revokedAt })
    .where(buildActiveAuthenticationSessionWhere(where, revokedAt))
    .returning({ id: authSessions.id });

  return rows.map((row: { id: string }): string => row.id);
}

function buildActiveAuthenticationSessionWhere(where: SQL, activeAt: Date = new Date()): SQL {
  return and(where, isNull(authSessions.revokedAt), gt(authSessions.expiresAt, activeAt))!;
}

const persistedAuthenticationSessionSelection: PersistedAuthenticationSessionSelection = {
  authMethodKind: authSessions.authMethodKind,
  oidcProviderId: authSessions.oidcProviderId,
  organizationId: authSessions.organizationId,
  principalEmail: principals.email,
  principalId: principals.id,
  principalType: principals.type,
  sessionId: authSessions.id,
};

function mapAuthenticationSessionRow(row: PersistedAuthenticationSessionRow): AuthenticationSessionRow {
  return {
    authMethodKind: readAuthSessionMethodKind(row.authMethodKind),
    oidcProviderId: row.oidcProviderId,
    organizationId: row.organizationId,
    principalEmail: row.principalEmail,
    principalId: row.principalId,
    principalType: row.principalType,
    sessionId: row.sessionId,
  };
}

function mapAuthSessionActorRow(row: PersistedAuthSessionActorRow): AuthSessionActorRow {
  return {
    authMethodKind: readAuthSessionMethodKind(row.authMethodKind),
    expiresAt: row.expiresAt,
    oidcProviderId: row.oidcProviderId,
    organizationId: row.organizationId,
    principalEmail: row.principalEmail,
    principalId: row.principalId,
    principalType: row.principalType,
    sessionId: row.sessionId,
  };
}

function readAuthSessionMethodKind(value: string): AuthSessionMethodKind {
  if (value === 'oidc' || value === 'password' || value === 'password_scoped') {
    return value;
  }

  throw new Error(`Unexpected auth session method kind: ${value}`);
}
