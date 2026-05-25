import { and, asc, eq, inArray } from 'drizzle-orm';
import { accessGroupMemberships, accessGroups } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type { PrincipalGroupCountRow, PrincipalGroupNameRow } from './rbac.query.types';

export async function listPrincipalGroupCounts(
  organizationId: string,
  principalIds: readonly string[],
): Promise<PrincipalGroupCountRow[]> {
  if (principalIds.length === 0) {
    return [];
  }

  return buildPrincipalGroupCountRows(await listPrincipalGroupNames(organizationId, principalIds));
}

export async function listPrincipalGroupNames(
  organizationId: string,
  principalIds: readonly string[],
): Promise<PrincipalGroupNameRow[]> {
  if (principalIds.length === 0) {
    return [];
  }

  return await getApiDatabase()
    .select({
      groupName: accessGroups.name,
      principalId: accessGroupMemberships.principalId,
    })
    .from(accessGroupMemberships)
    .innerJoin(accessGroups, eq(accessGroups.id, accessGroupMemberships.groupId))
    .where(
      and(
        eq(accessGroups.organizationId, organizationId),
        inArray(accessGroupMemberships.principalId, [...principalIds]),
      ),
    )
    .orderBy(asc(accessGroupMemberships.principalId), asc(accessGroups.name));
}

function buildPrincipalGroupCountRows(rows: readonly PrincipalGroupNameRow[]): PrincipalGroupCountRow[] {
  const groupCountByPrincipalId: Map<string, number> = new Map<string, number>();
  for (const row of rows) {
    groupCountByPrincipalId.set(row.principalId, (groupCountByPrincipalId.get(row.principalId) ?? 0) + 1);
  }

  return [...groupCountByPrincipalId.entries()].map(
    ([principalId, groupCount]: [string, number]): PrincipalGroupCountRow => ({ groupCount, principalId }),
  );
}
