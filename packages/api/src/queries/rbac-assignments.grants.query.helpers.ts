import { and, eq, inArray, isNull, type SQL } from 'drizzle-orm';
import type { SelectedFields } from 'drizzle-orm/pg-core/query-builders/select.types';
import {
  accessAssignments,
  accessGroupMemberships,
  accessGroups,
  accessRolePermissions,
  accessRoles,
  organizationMemberships,
} from '../db/schema';
import type { Database } from '../db/client';
import { getApiDatabase } from '../runtime/runtime-access';
import type { PrincipalGrantedRoleNameRow, RbacTransaction } from './rbac.query.types';

const directPrincipalGrantedRoleNameSelection: {
  principalId: typeof accessAssignments.subjectId;
  roleName: typeof accessRoles.name;
} = {
  principalId: accessAssignments.subjectId,
  roleName: accessRoles.name,
};

const groupPrincipalGrantedRoleNameSelection: {
  principalId: typeof accessGroupMemberships.principalId;
  roleName: typeof accessRoles.name;
} = {
  principalId: accessGroupMemberships.principalId,
  roleName: accessRoles.name,
};

export const principalPermissionGrantSelection: {
  permissionKey: typeof accessRolePermissions.permissionKey;
  roleId: typeof accessRoles.id;
  roleKind: typeof accessRoles.kind;
  roleName: typeof accessRoles.name;
  scopeId: typeof accessAssignments.scopeId;
  scopeType: typeof accessAssignments.scopeType;
} = {
  permissionKey: accessRolePermissions.permissionKey,
  roleId: accessRoles.id,
  roleKind: accessRoles.kind,
  roleName: accessRoles.name,
  scopeId: accessAssignments.scopeId,
  scopeType: accessAssignments.scopeType,
};

export function readDistinctPrincipalGrantedRoleNames(
  rows: readonly PrincipalGrantedRoleNameRow[],
): PrincipalGrantedRoleNameRow[] {
  const uniqueRowsByKey: Map<string, PrincipalGrantedRoleNameRow> = new Map<string, PrincipalGrantedRoleNameRow>();
  for (const row of rows) {
    uniqueRowsByKey.set(`${row.principalId}:${row.roleName}`, row);
  }

  return [...uniqueRowsByKey.values()].sort(
    (left: PrincipalGrantedRoleNameRow, right: PrincipalGrantedRoleNameRow): number =>
      left.principalId === right.principalId
        ? left.roleName.localeCompare(right.roleName)
        : left.principalId.localeCompare(right.principalId),
  );
}

export async function readDirectPrincipalGrantedRoleNames(
  organizationId: string,
  principalIds: readonly string[],
): Promise<PrincipalGrantedRoleNameRow[]> {
  return await readDirectPrincipalGrantRows<PrincipalGrantedRoleNameRow>(
    directPrincipalGrantedRoleNameSelection,
    and(
      eq(accessAssignments.organizationId, organizationId),
      eq(accessAssignments.subjectType, 'principal'),
      inArray(accessAssignments.subjectId, [...principalIds]),
      isNull(organizationMemberships.blockedAt),
    ),
  );
}

export async function readGroupPrincipalGrantedRoleNames(
  organizationId: string,
  principalIds: readonly string[],
): Promise<PrincipalGrantedRoleNameRow[]> {
  return await readGroupPrincipalGrantRows<PrincipalGrantedRoleNameRow>(
    groupPrincipalGrantedRoleNameSelection,
    and(
      eq(accessGroups.organizationId, organizationId),
      inArray(accessGroupMemberships.principalId, [...principalIds]),
      isNull(organizationMemberships.blockedAt),
    ),
  );
}

export async function readDirectPrincipalGrantRows<TResult>(
  selection: SelectedFields,
  where: SQL | undefined,
  executor: RbacGrantReader = getApiDatabase(),
): Promise<TResult[]> {
  return (await executor
    .select(selection)
    .from(accessAssignments)
    .innerJoin(organizationMemberships, buildDirectPrincipalMembershipJoin())
    .innerJoin(accessRoles, eq(accessRoles.id, accessAssignments.roleId))
    .innerJoin(accessRolePermissions, eq(accessRolePermissions.roleId, accessRoles.id))
    .where(where)) as TResult[];
}

export async function readGroupPrincipalGrantRows<TResult>(
  selection: SelectedFields,
  where: SQL | undefined,
  executor: RbacGrantReader = getApiDatabase(),
): Promise<TResult[]> {
  return (await executor
    .select(selection)
    .from(accessGroupMemberships)
    .innerJoin(accessGroups, eq(accessGroups.id, accessGroupMemberships.groupId))
    .innerJoin(organizationMemberships, buildGroupPrincipalMembershipJoin())
    .innerJoin(accessAssignments, buildGroupSubjectAssignmentJoin())
    .innerJoin(accessRoles, eq(accessRoles.id, accessAssignments.roleId))
    .innerJoin(accessRolePermissions, eq(accessRolePermissions.roleId, accessRoles.id))
    .where(where)) as TResult[];
}

export function buildDirectPrincipalMembershipJoin(): SQL {
  return and(
    eq(organizationMemberships.organizationId, accessAssignments.organizationId),
    eq(organizationMemberships.principalId, accessAssignments.subjectId),
  )!;
}

export function buildGroupPrincipalMembershipJoin(): SQL {
  return and(
    eq(organizationMemberships.organizationId, accessGroups.organizationId),
    eq(organizationMemberships.principalId, accessGroupMemberships.principalId),
  )!;
}

export function buildGroupSubjectAssignmentJoin(): SQL {
  return and(eq(accessAssignments.subjectType, 'group'), eq(accessAssignments.subjectId, accessGroups.id))!;
}

type RbacGrantReader = Database | RbacTransaction;
