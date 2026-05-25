import { and, eq, gt, isNull, or, sql, type SQL } from 'drizzle-orm';
import { authSessions, organizationMemberships } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';

interface ListBlockedOrganizationUserSessionIdsInput {
  activeAt: Date;
  organizationId: string;
  principalId: string;
}

interface AuthenticationSessionIdRow {
  id: string;
}

export async function listActiveAuthenticationSessionIdsForBlockedOrganizationUser(
  input: ListBlockedOrganizationUserSessionIdsInput,
): Promise<string[]> {
  const rows: AuthenticationSessionIdRow[] = await getApiDatabase()
    .select({ id: authSessions.id })
    .from(authSessions)
    .where(
      buildActiveAuthenticationSessionWhere(
        and(eq(authSessions.principalId, input.principalId), buildBlockedOrganizationUserSessionWhere(input))!,
        input.activeAt,
      ),
    );

  return rows.map((row: AuthenticationSessionIdRow): string => row.id);
}

function buildActiveAuthenticationSessionWhere(where: SQL, activeAt: Date): SQL {
  return and(where, isNull(authSessions.revokedAt), gt(authSessions.expiresAt, activeAt))!;
}

function buildBlockedOrganizationUserSessionWhere(input: ListBlockedOrganizationUserSessionIdsInput): SQL {
  return or(
    eq(authSessions.organizationId, input.organizationId),
    and(isNull(authSessions.organizationId), buildPrincipalHasNoActiveOrganizationMembershipsWhere()),
  )!;
}

function buildPrincipalHasNoActiveOrganizationMembershipsWhere(): SQL {
  return sql`not exists (
    select 1
    from ${organizationMemberships} as active_organization_memberships
    where active_organization_memberships.principal_id = ${authSessions.principalId}
      and active_organization_memberships.blocked_at is null
  )`;
}
