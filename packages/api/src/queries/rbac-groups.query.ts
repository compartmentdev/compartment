import { and, asc, eq, inArray, type SQL } from 'drizzle-orm';
import type { Database } from '../db/client';
import {
  accessAssignments,
  accessGroupMemberships,
  accessGroups,
  localCredentials,
  organizationMemberships,
  principals,
} from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type {
  AccessGroupPrincipalMembershipInput,
  AccessGroupAggregateRow,
  AccessGroupMemberQueryRow,
  AccessGroupMemberRow,
  AccessGroupRow,
  CreateAccessGroupInput,
  CreateAccessGroupMembershipInput,
  RbacTransaction,
} from './rbac.query.types';
import {
  readAccessGroupAggregateSelection,
  toAccessGroupMemberRow,
  toAccessGroupRow,
} from './rbac-groups.query.helpers';

export { listPrincipalGroupCounts } from './rbac-principal-groups.query';

type AggregateRowsPromise = Promise<AccessGroupAggregateRow[]>;

interface AccessGroupAggregateQuery {
  limit(limit: number): AggregateRowsPromise;
  orderBy(orderBy: SQL): AggregateRowsPromise;
}
export async function listAccessGroups(organizationId: string): Promise<AccessGroupRow[]> {
  return await readAccessGroupsWithExecutor(getApiDatabase(), organizationId);
}

export async function findAccessGroupById(
  organizationId: string,
  groupId: string,
): Promise<AccessGroupRow | undefined> {
  return await readAccessGroupByIdWithExecutor(getApiDatabase(), organizationId, groupId);
}

export async function findAccessGroupByIdWithExecutor(
  executor: AccessGroupReader,
  organizationId: string,
  groupId: string,
): Promise<AccessGroupRow | undefined> {
  return await readAccessGroupByIdWithExecutor(executor, organizationId, groupId);
}

export async function createAccessGroupWithExecutor(
  executor: RbacTransaction,
  input: CreateAccessGroupInput,
): Promise<AccessGroupRow> {
  await executor.insert(accessGroups).values({
    description: input.description,
    id: input.id,
    name: input.name,
    organizationId: input.organizationId,
    updatedAt: input.updatedAt,
  });

  return requireAccessGroup(await readAccessGroupByIdWithExecutor(executor, input.organizationId, input.id));
}

export async function updateAccessGroupWithExecutor(
  executor: RbacTransaction,
  organizationId: string,
  groupId: string,
  groupName: string,
  description: string | null,
  updatedAt: Date,
): Promise<void> {
  await executor
    .update(accessGroups)
    .set({ description, name: groupName, updatedAt })
    .where(and(eq(accessGroups.organizationId, organizationId), eq(accessGroups.id, groupId)));
}
export async function deleteAccessGroupWithExecutor(
  executor: RbacTransaction,
  organizationId: string,
  groupId: string,
): Promise<void> {
  await executor
    .delete(accessGroups)
    .where(and(eq(accessGroups.organizationId, organizationId), eq(accessGroups.id, groupId)));
}

export async function listAccessGroupMembers(organizationId: string, groupId: string): Promise<AccessGroupMemberRow[]> {
  return (await readAccessGroupMemberRows(organizationId, groupId)).map(toAccessGroupMemberRow);
}

export async function addAccessGroupMembershipWithExecutor(
  executor: RbacTransaction,
  input: CreateAccessGroupMembershipInput,
): Promise<boolean> {
  const rows: { id: string }[] = await executor
    .insert(accessGroupMemberships)
    .values({
      groupId: input.groupId,
      id: input.id,
      principalId: input.principalId,
    })
    .onConflictDoNothing()
    .returning({ id: accessGroupMemberships.id });

  return rows[0] !== undefined;
}

export async function deleteAccessGroupMembershipWithExecutor(
  executor: RbacTransaction,
  groupId: string,
  principalId: string,
): Promise<boolean> {
  const rows: { id: string }[] = await executor
    .delete(accessGroupMemberships)
    .where(and(eq(accessGroupMemberships.groupId, groupId), eq(accessGroupMemberships.principalId, principalId)))
    .returning({ id: accessGroupMemberships.id });

  return rows[0] !== undefined;
}

export async function hasAccessGroupPrincipalMembershipWithExecutor(
  executor: RbacTransaction,
  input: AccessGroupPrincipalMembershipInput,
): Promise<boolean> {
  const rows: { id: string }[] = await executor
    .select({ id: accessGroupMemberships.id })
    .from(accessGroupMemberships)
    .innerJoin(accessGroups, eq(accessGroups.id, accessGroupMemberships.groupId))
    .where(
      and(
        eq(accessGroups.organizationId, input.organizationId),
        eq(accessGroupMemberships.groupId, input.groupId),
        eq(accessGroupMemberships.principalId, input.principalId),
      ),
    )
    .limit(1);

  return rows[0] !== undefined;
}

export async function deletePrincipalAccessGroupMembershipsWithExecutor(
  executor: RbacTransaction,
  organizationId: string,
  principalId: string,
): Promise<void> {
  const groupIds: { id: string }[] = await executor
    .select({ id: accessGroups.id })
    .from(accessGroups)
    .where(eq(accessGroups.organizationId, organizationId));
  if (groupIds.length === 0) {
    return;
  }

  await executor.delete(accessGroupMemberships).where(
    and(
      eq(accessGroupMemberships.principalId, principalId),
      inArray(
        accessGroupMemberships.groupId,
        groupIds.map((row: { id: string }): string => row.id),
      ),
    ),
  );
}

export async function listPrincipalGroups(organizationId: string, principalId: string): Promise<AccessGroupRow[]> {
  const groupIds: { id: string }[] = await getApiDatabase()
    .select({ id: accessGroups.id })
    .from(accessGroupMemberships)
    .innerJoin(accessGroups, eq(accessGroups.id, accessGroupMemberships.groupId))
    .where(and(eq(accessGroups.organizationId, organizationId), eq(accessGroupMemberships.principalId, principalId)));

  if (groupIds.length === 0) {
    return [];
  }

  return await readAccessGroupsWithExecutor(getApiDatabase(), organizationId).then(
    (groups: AccessGroupRow[]): AccessGroupRow[] =>
      groups.filter((group: AccessGroupRow): boolean =>
        groupIds.some((row: { id: string }): boolean => row.id === group.id),
      ),
  );
}

function requireAccessGroup(group: AccessGroupRow | undefined): AccessGroupRow {
  if (group === undefined) {
    throw new Error('Expected access group.');
  }

  return group;
}

type AccessGroupReader = Database | RbacTransaction;

async function readAccessGroupMemberRows(
  organizationId: string,
  groupId: string,
): Promise<AccessGroupMemberQueryRow[]> {
  return await getApiDatabase()
    .select({
      blockedAt: organizationMemberships.blockedAt,
      email: principals.email,
      id: principals.id,
      passwordHash: localCredentials.passwordHash,
    })
    .from(accessGroupMemberships)
    .innerJoin(accessGroups, eq(accessGroups.id, accessGroupMemberships.groupId))
    .innerJoin(principals, eq(principals.id, accessGroupMemberships.principalId))
    .innerJoin(
      organizationMemberships,
      and(
        eq(organizationMemberships.organizationId, accessGroups.organizationId),
        eq(organizationMemberships.principalId, principals.id),
      ),
    )
    .leftJoin(localCredentials, eq(localCredentials.principalId, principals.id))
    .where(and(eq(accessGroups.organizationId, organizationId), eq(accessGroupMemberships.groupId, groupId)))
    .orderBy(asc(principals.email));
}

async function readAccessGroupsWithExecutor(
  executor: AccessGroupReader,
  organizationId: string,
): Promise<AccessGroupRow[]> {
  const rows: AccessGroupAggregateRow[] = await readAccessGroupAggregateRows(executor, organizationId);
  return rows.map(toAccessGroupRow);
}

async function readAccessGroupByIdWithExecutor(
  executor: AccessGroupReader,
  organizationId: string,
  groupId: string,
): Promise<AccessGroupRow | undefined> {
  const rows: AccessGroupAggregateRow[] = await readAccessGroupAggregateRows(executor, organizationId, groupId);
  return rows[0] === undefined ? undefined : toAccessGroupRow(rows[0]);
}
async function readAccessGroupAggregateRows(
  executor: AccessGroupReader,
  organizationId: string,
  groupId?: string,
): Promise<AccessGroupAggregateRow[]> {
  const scopedRows: AccessGroupAggregateQuery = executor
    .select(readAccessGroupAggregateSelection())
    .from(accessGroups)
    .leftJoin(accessGroupMemberships, eq(accessGroupMemberships.groupId, accessGroups.id))
    .leftJoin(
      accessAssignments,
      and(eq(accessAssignments.subjectType, 'group'), eq(accessAssignments.subjectId, accessGroups.id)),
    )
    .where(
      groupId === undefined
        ? eq(accessGroups.organizationId, organizationId)
        : and(eq(accessGroups.organizationId, organizationId), eq(accessGroups.id, groupId)),
    )
    .groupBy(accessGroups.id);

  return groupId === undefined ? await scopedRows.orderBy(asc(accessGroups.name)) : await scopedRows.limit(1);
}
