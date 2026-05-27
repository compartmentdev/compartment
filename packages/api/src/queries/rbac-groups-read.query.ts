import { and, asc, eq, type SQL } from 'drizzle-orm';
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
  AccessGroupAggregateRow,
  AccessGroupMemberQueryRow,
  AccessGroupRow,
  RbacTransaction,
} from './rbac.query.types';
import { readAccessGroupAggregateSelection, toAccessGroupRow } from './rbac-groups.query.helpers';

type AggregateRowsPromise = Promise<AccessGroupAggregateRow[]>;

interface AccessGroupAggregateQuery {
  limit(limit: number): AggregateRowsPromise;
  orderBy(orderBy: SQL): AggregateRowsPromise;
}

export type AccessGroupReader = Database | RbacTransaction;

export async function readAccessGroupsWithExecutor(
  executor: AccessGroupReader,
  organizationId: string,
): Promise<AccessGroupRow[]> {
  const rows: AccessGroupAggregateRow[] = await readAccessGroupAggregateRows(executor, organizationId);
  return rows.map(toAccessGroupRow);
}

export async function readAccessGroupByIdWithExecutor(
  executor: AccessGroupReader,
  organizationId: string,
  groupId: string,
): Promise<AccessGroupRow | undefined> {
  const rows: AccessGroupAggregateRow[] = await readAccessGroupAggregateRows(executor, organizationId, groupId);
  return rows[0] === undefined ? undefined : toAccessGroupRow(rows[0]);
}

export async function readAccessGroupMemberRows(
  organizationId: string,
  groupId: string,
): Promise<AccessGroupMemberQueryRow[]> {
  return await getAccessGroupMemberRowsQuery(organizationId, groupId);
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
    .where(readAccessGroupAggregateScope(organizationId, groupId))
    .groupBy(accessGroups.id);

  return groupId === undefined ? await scopedRows.orderBy(asc(accessGroups.name)) : await scopedRows.limit(1);
}

function readAccessGroupAggregateScope(organizationId: string, groupId: string | undefined): SQL {
  return groupId === undefined
    ? eq(accessGroups.organizationId, organizationId)
    : and(eq(accessGroups.organizationId, organizationId), eq(accessGroups.id, groupId))!;
}

async function getAccessGroupMemberRowsQuery(
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
