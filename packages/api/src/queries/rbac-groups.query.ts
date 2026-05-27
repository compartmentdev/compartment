import type { ListPagination } from '@compartment/contracts';
import { and, eq, inArray } from 'drizzle-orm';
import { accessGroupMemberships, accessGroups } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import { buildListPagination } from './list-pagination.query';
import { countAccessGroups, readAccessGroupPageRows } from './rbac-groups-list.query';
import type { AccessGroupsPageResult, ListAccessGroupsPageInput } from './rbac-groups-list.query.types';
import {
  readAccessGroupByIdWithExecutor,
  readAccessGroupMemberRows,
  readAccessGroupsWithExecutor,
  type AccessGroupReader,
} from './rbac-groups-read.query';
import type {
  AccessGroupPrincipalMembershipInput,
  AccessGroupMemberRow,
  AccessGroupRow,
  CreateAccessGroupInput,
  CreateAccessGroupMembershipInput,
  RbacTransaction,
} from './rbac.query.types';
import { toAccessGroupMemberRow } from './rbac-groups.query.helpers';

export { listPrincipalGroupCounts } from './rbac-principal-groups.query';

export async function listAccessGroups(organizationId: string): Promise<AccessGroupRow[]> {
  return await readAccessGroupsWithExecutor(getApiDatabase(), organizationId);
}

export async function listAccessGroupsPage(input: ListAccessGroupsPageInput): Promise<AccessGroupsPageResult> {
  const pagination: ListPagination = await readAccessGroupPagination(input);

  return {
    groups: await readAccessGroupPageRows({ ...input, page: pagination.page }),
    pagination,
  };
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

async function readAccessGroupPagination(input: ListAccessGroupsPageInput): Promise<ListPagination> {
  const totalItems: number = await countAccessGroups(input.organizationId, input.search);

  return buildListPagination({
    page: input.page,
    perPage: input.perPage,
    totalItems,
  });
}
