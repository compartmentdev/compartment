import { and, eq, gt, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import {
  appAccessCodes,
  appAccessSessions,
  authSessions,
  deploymentCustomDomains,
  deploymentRoutes,
  deployments,
  environments,
  projects,
} from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type {
  ActiveAppAccessSessionRow,
  AppAccessCodeRow,
  AppAccessQueryExecutor,
  CreateAppAccessCodeInput,
  CreateAppAccessSessionInput,
  RevokeBlockedOrganizationUserAppAccessSessionsInput,
} from './app-access.query.types';

interface AuthSessionIdRow {
  authSessionId: string;
}

export async function createAppAccessCode(input: CreateAppAccessCodeInput): Promise<void> {
  await createAppAccessCodeWithExecutor(getApiDatabase(), input);
}

async function createAppAccessCodeWithExecutor(
  executor: AppAccessQueryExecutor,
  input: CreateAppAccessCodeInput,
): Promise<void> {
  await executor.insert(appAccessCodes).values(input);
}

export async function findAppAccessCodeByTokenHash(tokenHash: string): Promise<AppAccessCodeRow | undefined> {
  const rows: AppAccessCodeRow[] = await getApiDatabase()
    .select()
    .from(appAccessCodes)
    .where(eq(appAccessCodes.tokenHash, tokenHash))
    .limit(1);

  return rows[0];
}

export async function consumeAppAccessCode(codeId: string, consumedAt: Date): Promise<boolean> {
  const rows: { id: string }[] = await getApiDatabase()
    .update(appAccessCodes)
    .set({ consumedAt })
    .where(
      and(eq(appAccessCodes.id, codeId), isNull(appAccessCodes.consumedAt), gt(appAccessCodes.expiresAt, consumedAt)),
    )
    .returning({ id: appAccessCodes.id });

  return rows.length > 0;
}

export async function createAppAccessSession(input: CreateAppAccessSessionInput): Promise<void> {
  await createAppAccessSessionWithExecutor(getApiDatabase(), input);
}

async function createAppAccessSessionWithExecutor(
  executor: AppAccessQueryExecutor,
  input: CreateAppAccessSessionInput,
): Promise<void> {
  await executor.insert(appAccessSessions).values(input);
}

export async function findActiveAppAccessSessionByTokenHash(
  tokenHash: string,
): Promise<ActiveAppAccessSessionRow | undefined> {
  const rows: ActiveAppAccessSessionRow[] = await getApiDatabase()
    .select({
      appSessionId: appAccessSessions.id,
    })
    .from(appAccessSessions)
    .where(
      and(
        eq(appAccessSessions.tokenHash, tokenHash),
        isNull(appAccessSessions.revokedAt),
        gt(appAccessSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return rows[0];
}

export async function revokeAppAccessSession(appSessionId: string, revokedAt: Date): Promise<void> {
  await getApiDatabase()
    .update(appAccessSessions)
    .set({ revokedAt })
    .where(and(eq(appAccessSessions.id, appSessionId), isNull(appAccessSessions.revokedAt)));
}

export async function revokeAppAccessSessionsByAuthSessionId(authSessionId: string, revokedAt: Date): Promise<void> {
  await getApiDatabase()
    .update(appAccessSessions)
    .set({ revokedAt })
    .where(and(eq(appAccessSessions.authSessionId, authSessionId), isNull(appAccessSessions.revokedAt)));
}

export async function revokeAppAccessSessionsByAuthSessionIdsWithExecutor(
  executor: AppAccessQueryExecutor,
  authSessionIds: readonly string[],
  revokedAt: Date,
): Promise<void> {
  if (authSessionIds.length === 0) {
    return;
  }

  await executor
    .update(appAccessSessions)
    .set({ revokedAt })
    .where(and(inArray(appAccessSessions.authSessionId, authSessionIds), isNull(appAccessSessions.revokedAt)));
}

export async function revokeBlockedOrganizationUserAppAccessSessions(
  input: RevokeBlockedOrganizationUserAppAccessSessionsInput,
): Promise<string[]> {
  const rows: AuthSessionIdRow[] = await getApiDatabase()
    .update(appAccessSessions)
    .set({ revokedAt: input.revokedAt })
    .where(buildBlockedOrganizationUserAppAccessSessionWhere(input))
    .returning({ authSessionId: appAccessSessions.authSessionId });

  return [...new Set(rows.map((row: AuthSessionIdRow): string => row.authSessionId))];
}

function buildBlockedOrganizationUserAppAccessSessionWhere(
  input: RevokeBlockedOrganizationUserAppAccessSessionsInput,
): SQL {
  return and(
    isNull(appAccessSessions.revokedAt),
    gt(appAccessSessions.expiresAt, input.revokedAt),
    buildAppAccessSessionPrincipalWhere(input.principalId),
    buildAppAccessSessionOrganizationHostWhere(input),
  )!;
}

function buildAppAccessSessionPrincipalWhere(principalId: string): SQL {
  return sql`exists (
    select 1
    from ${authSessions}
    where ${authSessions.id} = ${appAccessSessions.authSessionId}
      and ${authSessions.principalId} = ${principalId}
  )`;
}

function buildAppAccessSessionOrganizationHostWhere(input: RevokeBlockedOrganizationUserAppAccessSessionsInput): SQL {
  return sql`(
    ${buildCanonicalAppAccessSessionOrganizationHostWhere(input)}
    or ${buildCustomAppAccessSessionOrganizationHostWhere(input.organizationId)}
  )`;
}

function buildCanonicalAppAccessSessionOrganizationHostWhere(
  input: RevokeBlockedOrganizationUserAppAccessSessionsInput,
): SQL {
  return sql`exists (
    select 1
    from ${deploymentRoutes}
    inner join ${deployments} on ${deployments.id} = ${deploymentRoutes.deploymentId}
    inner join ${environments} on ${environments.id} = ${deployments.environmentId}
    inner join ${projects} on ${projects.id} = ${environments.projectId}
    where ${deployments.isActive} = true
      and ${projects.organizationId} = ${input.organizationId}
      and ${appAccessSessions.host} = ${deploymentRoutes.subdomain} || '.' || ${input.baseDomain}
  )`;
}

function buildCustomAppAccessSessionOrganizationHostWhere(organizationId: string): SQL {
  return sql`exists (
    select 1
    from ${deploymentCustomDomains}
    inner join ${environments} on ${environments.id} = ${deploymentCustomDomains.environmentId}
    inner join ${projects} on ${projects.id} = ${environments.projectId}
    inner join ${deployments}
      on ${deployments.environmentId} = ${deploymentCustomDomains.environmentId}
      and ${deployments.projectServiceId} = ${deploymentCustomDomains.projectServiceId}
    where ${deployments.isActive} = true
      and ${deploymentCustomDomains.ownershipStatus} = 'valid'
      and ${deploymentCustomDomains.routingStatus} = 'valid'
      and ${deploymentCustomDomains.edgeRoutingEnabled} = true
      and ${projects.organizationId} = ${organizationId}
      and ${appAccessSessions.host} = ${deploymentCustomDomains.host}
  )`;
}
