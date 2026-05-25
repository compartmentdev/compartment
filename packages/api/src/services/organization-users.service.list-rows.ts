import { readFriendlyAccessSummary, type PermissionKey } from '@compartment/contracts';
import {
  listDirectAssignmentScopesForPrincipals,
  listDirectPrincipalPermissionKeys,
  listGroupPrincipalPermissionKeys,
} from '../queries/rbac-assignments.query';
import { listPrincipalGroupNames } from '../queries/rbac-principal-groups.query';
import type { PrincipalGroupNameRow, PrincipalPermissionKeyRow, PrincipalScopeRow } from '../queries/rbac.query.types';
import { buildScopeLabelByScopeKey, toScopeKey } from './access-scope-labels.service.helpers';
import type { OrganizationUserListRowResult, OrganizationUserResult } from './organization-users.service.types';

interface UserListRowDependencies {
  directScopeLabelsByPrincipalId: ReadonlyMap<string, string[]>;
  groupNamesByPrincipalId: ReadonlyMap<string, string[]>;
  permissionKeysByPrincipalId: ReadonlyMap<string, PermissionKey[]>;
}

export async function hydrateOrganizationUserListRows(
  organizationId: string,
  users: readonly OrganizationUserResult[],
): Promise<OrganizationUserListRowResult[]> {
  if (users.length === 0) {
    return [];
  }

  const dependencies: UserListRowDependencies = await readUserListRowDependencies(organizationId, users);
  return users.map(
    (user: OrganizationUserResult): OrganizationUserListRowResult => ({
      ...user,
      accessSummary: readFriendlyAccessSummary(dependencies.permissionKeysByPrincipalId.get(user.id) ?? []),
      directAccessScopeLabels: dependencies.directScopeLabelsByPrincipalId.get(user.id) ?? [],
      groupNames: dependencies.groupNamesByPrincipalId.get(user.id) ?? [],
    }),
  );
}

async function readUserListRowDependencies(
  organizationId: string,
  users: readonly OrganizationUserResult[],
): Promise<UserListRowDependencies> {
  const principalIds: string[] = [...new Set(users.map((user: OrganizationUserResult): string => user.id))];
  const [groupNames, directScopes, directPermissionKeys, groupPermissionKeys]: [
    PrincipalGroupNameRow[],
    PrincipalScopeRow[],
    PrincipalPermissionKeyRow[],
    PrincipalPermissionKeyRow[],
  ] = await Promise.all([
    listPrincipalGroupNames(organizationId, principalIds),
    listDirectAssignmentScopesForPrincipals(organizationId, principalIds),
    listDirectPrincipalPermissionKeys(organizationId, principalIds),
    listGroupPrincipalPermissionKeys(organizationId, principalIds),
  ]);

  return {
    directScopeLabelsByPrincipalId: await buildDirectScopeLabelsByPrincipalId(directScopes),
    groupNamesByPrincipalId: buildGroupNamesByPrincipalId(groupNames),
    permissionKeysByPrincipalId: buildPermissionKeysByPrincipalId([...directPermissionKeys, ...groupPermissionKeys]),
  };
}

function buildGroupNamesByPrincipalId(rows: readonly PrincipalGroupNameRow[]): ReadonlyMap<string, string[]> {
  const namesByPrincipalId: Map<string, string[]> = new Map<string, string[]>();
  for (const row of rows) {
    const principalGroupNames: string[] = namesByPrincipalId.get(row.principalId) ?? [];
    principalGroupNames.push(row.groupName);
    namesByPrincipalId.set(row.principalId, principalGroupNames);
  }

  return namesByPrincipalId;
}

function buildPermissionKeysByPrincipalId(
  rows: readonly PrincipalPermissionKeyRow[],
): ReadonlyMap<string, PermissionKey[]> {
  const permissionKeysByPrincipalId: Map<string, PermissionKey[]> = new Map<string, PermissionKey[]>();
  for (const row of rows) {
    const principalPermissionKeys: PermissionKey[] = permissionKeysByPrincipalId.get(row.principalId) ?? [];
    principalPermissionKeys.push(row.permissionKey);
    permissionKeysByPrincipalId.set(row.principalId, principalPermissionKeys);
  }

  return permissionKeysByPrincipalId;
}

async function buildDirectScopeLabelsByPrincipalId(
  rows: readonly PrincipalScopeRow[],
): Promise<ReadonlyMap<string, string[]>> {
  const labelByScopeKey: ReadonlyMap<string, string> = await buildScopeLabelByScopeKey(rows);
  const labelsByPrincipalId: Map<string, string[]> = new Map<string, string[]>();
  for (const row of rows) {
    const scopeLabel: string | undefined = labelByScopeKey.get(toScopeKey(row.scopeType, row.scopeId));
    if (scopeLabel === undefined) {
      continue;
    }

    const principalLabels: string[] = labelsByPrincipalId.get(row.principalId) ?? [];
    if (!principalLabels.includes(scopeLabel)) {
      principalLabels.push(scopeLabel);
      principalLabels.sort((left: string, right: string): number => left.localeCompare(right));
      labelsByPrincipalId.set(row.principalId, principalLabels);
    }
  }

  return labelsByPrincipalId;
}
