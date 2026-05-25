import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  accessAssignments,
  accessGroupMemberships,
  accessGroups,
  accessRolePermissions,
  organizationMemberships,
} from '../db/schema';
import type { Database } from '../db/client';
import { getApiDatabase } from '../runtime/runtime-access';
import {
  buildGroupPrincipalMembershipJoin,
  buildGroupSubjectAssignmentJoin,
  principalPermissionGrantSelection,
  readDirectPrincipalGrantRows,
  readDirectPrincipalGrantedRoleNames,
  readDistinctPrincipalGrantedRoleNames,
  readGroupPrincipalGrantRows,
  readGroupPrincipalGrantedRoleNames,
} from './rbac-assignments.grants.query.helpers';
import type {
  AllPrincipalPermissionGrantStateRow,
  AllPrincipalPermissionGrantStateQueryRow,
  PrincipalGrantedRoleNameRow,
  PrincipalPermissionKeyRow,
  PrincipalPermissionGrantQueryRow,
  PrincipalPermissionGrantRow,
  RbacTransaction,
} from './rbac.query.types';

export async function listDirectPrincipalPermissionGrantRows(
  organizationId: string,
  principalId: string,
): Promise<PrincipalPermissionGrantRow[]> {
  return (await readDirectPrincipalPermissionGrantQueryRows(getApiDatabase(), organizationId, principalId)).map(
    toPrincipalPermissionGrantRow,
  );
}

export async function listGroupPrincipalPermissionGrantRows(
  organizationId: string,
  principalId: string,
): Promise<PrincipalPermissionGrantRow[]> {
  return (await readGroupPrincipalPermissionGrantQueryRows(getApiDatabase(), organizationId, principalId)).map(
    toPrincipalPermissionGrantRow,
  );
}

export async function listDirectPrincipalPermissionGrantRowsWithExecutor(
  executor: RbacTransaction,
  organizationId: string,
  principalId: string,
): Promise<PrincipalPermissionGrantRow[]> {
  return (await readDirectPrincipalPermissionGrantQueryRows(executor, organizationId, principalId)).map(
    toPrincipalPermissionGrantRow,
  );
}

export async function listGroupPrincipalPermissionGrantRowsWithExecutor(
  executor: RbacTransaction,
  organizationId: string,
  principalId: string,
): Promise<PrincipalPermissionGrantRow[]> {
  return (await readGroupPrincipalPermissionGrantQueryRows(executor, organizationId, principalId)).map(
    toPrincipalPermissionGrantRow,
  );
}

export async function listAllPrincipalPermissionGrantStates(): Promise<AllPrincipalPermissionGrantStateRow[]> {
  const directStates: AllPrincipalPermissionGrantStateRow[] = await readDirectPrincipalPermissionGrantStates();
  const groupStates: AllPrincipalPermissionGrantStateRow[] = await readGroupPrincipalPermissionGrantStates();
  return [...directStates, ...groupStates];
}

export async function listPrincipalGrantedRoleNames(
  organizationId: string,
  principalIds: readonly string[],
): Promise<PrincipalGrantedRoleNameRow[]> {
  if (principalIds.length === 0) {
    return [];
  }

  const directRoleNames: PrincipalGrantedRoleNameRow[] = await readDirectPrincipalGrantedRoleNames(
    organizationId,
    principalIds,
  );
  const groupRoleNames: PrincipalGrantedRoleNameRow[] = await readGroupPrincipalGrantedRoleNames(
    organizationId,
    principalIds,
  );

  return readDistinctPrincipalGrantedRoleNames([...directRoleNames, ...groupRoleNames]);
}

export async function listDirectPrincipalPermissionKeys(
  organizationId: string,
  principalIds: readonly string[],
): Promise<PrincipalPermissionKeyRow[]> {
  if (principalIds.length === 0) {
    return [];
  }

  return await readDirectPrincipalGrantRows<PrincipalPermissionKeyRow>(
    {
      permissionKey: accessRolePermissions.permissionKey,
      principalId: accessAssignments.subjectId,
    },
    and(
      eq(accessAssignments.organizationId, organizationId),
      eq(accessAssignments.subjectType, 'principal'),
      inArray(accessAssignments.subjectId, [...principalIds]),
      isNull(organizationMemberships.blockedAt),
    ),
  );
}

export async function listGroupPrincipalPermissionKeys(
  organizationId: string,
  principalIds: readonly string[],
): Promise<PrincipalPermissionKeyRow[]> {
  if (principalIds.length === 0) {
    return [];
  }

  return await readGroupPrincipalGrantRows<PrincipalPermissionKeyRow>(
    {
      permissionKey: accessRolePermissions.permissionKey,
      principalId: accessGroupMemberships.principalId,
    },
    and(
      eq(accessGroups.organizationId, organizationId),
      inArray(accessGroupMemberships.principalId, [...principalIds]),
      isNull(organizationMemberships.blockedAt),
    ),
  );
}

async function readDirectPrincipalPermissionGrantQueryRows(
  executor: RbacGrantReader,
  organizationId: string,
  principalId: string,
): Promise<PrincipalPermissionGrantQueryRow[]> {
  return await readDirectPrincipalGrantRows<PrincipalPermissionGrantQueryRow>(
    principalPermissionGrantSelection,
    and(
      eq(accessAssignments.organizationId, organizationId),
      eq(accessAssignments.subjectType, 'principal'),
      eq(accessAssignments.subjectId, principalId),
      isNull(organizationMemberships.blockedAt),
    ),
    executor,
  );
}

async function readGroupPrincipalPermissionGrantQueryRows(
  executor: RbacGrantReader,
  organizationId: string,
  principalId: string,
): Promise<PrincipalPermissionGrantQueryRow[]> {
  return await readGroupPrincipalGrantRows<PrincipalPermissionGrantQueryRow>(
    principalPermissionGrantSelection,
    and(
      eq(accessGroups.organizationId, organizationId),
      eq(accessGroupMemberships.principalId, principalId),
      isNull(organizationMemberships.blockedAt),
    ),
    executor,
  );
}

type RbacGrantReader = Database | RbacTransaction;

async function readDirectPrincipalPermissionGrantStates(): Promise<AllPrincipalPermissionGrantStateRow[]> {
  const rows: AllPrincipalPermissionGrantStateQueryRow[] = (await getApiDatabase()
    .select({
      permissionKey: accessRolePermissions.permissionKey,
      principalId: accessAssignments.subjectId,
      scopeId: accessAssignments.scopeId,
      scopeType: accessAssignments.scopeType,
    })
    .from(accessAssignments)
    .innerJoin(
      organizationMemberships,
      and(
        eq(organizationMemberships.organizationId, accessAssignments.organizationId),
        eq(organizationMemberships.principalId, accessAssignments.subjectId),
      ),
    )
    .innerJoin(accessRolePermissions, eq(accessRolePermissions.roleId, accessAssignments.roleId))
    .where(
      and(eq(accessAssignments.subjectType, 'principal'), isNull(organizationMemberships.blockedAt)),
    )) as AllPrincipalPermissionGrantStateQueryRow[];

  return rows.map(toAllPrincipalPermissionGrantStateRow);
}

async function readGroupPrincipalPermissionGrantStates(): Promise<AllPrincipalPermissionGrantStateRow[]> {
  const rows: AllPrincipalPermissionGrantStateQueryRow[] = (await getApiDatabase()
    .select({
      permissionKey: accessRolePermissions.permissionKey,
      principalId: accessGroupMemberships.principalId,
      scopeId: accessAssignments.scopeId,
      scopeType: accessAssignments.scopeType,
    })
    .from(accessGroupMemberships)
    .innerJoin(accessGroups, eq(accessGroups.id, accessGroupMemberships.groupId))
    .innerJoin(organizationMemberships, buildGroupPrincipalMembershipJoin())
    .innerJoin(accessAssignments, buildGroupSubjectAssignmentJoin())
    .innerJoin(accessRolePermissions, eq(accessRolePermissions.roleId, accessAssignments.roleId))
    .where(isNull(organizationMemberships.blockedAt))) as AllPrincipalPermissionGrantStateQueryRow[];

  return rows.map(toAllPrincipalPermissionGrantStateRow);
}

function toPrincipalPermissionGrantRow(row: PrincipalPermissionGrantQueryRow): PrincipalPermissionGrantRow {
  return {
    permissionKey: row.permissionKey,
    roleId: row.roleId,
    roleKind: row.roleKind,
    roleName: row.roleName,
    scopeId: row.scopeId,
    scopeType: row.scopeType,
  };
}

function toAllPrincipalPermissionGrantStateRow(
  row: AllPrincipalPermissionGrantStateQueryRow,
): AllPrincipalPermissionGrantStateRow {
  return {
    permissionKey: row.permissionKey,
    principalId: row.principalId,
    scopeId: row.scopeId,
    scopeType: row.scopeType,
  };
}
