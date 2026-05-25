import {
  readPermissionFamily,
  readFriendlyAccessSummary,
  type AccessAssignmentSummary,
  type AccessGroupListRow,
  type AccessRoleSummary,
  type AccessRoleListRow,
  type PermissionKey,
} from '@compartment/contracts/browser';

export function formatGroupAccessSummary(group: AccessGroupListRow): string {
  return formatAccessSummaryList(group.assignedRoleNames, 'No assignments');
}

export function formatGroupScopeSummary(group: AccessGroupListRow): string {
  return formatAccessSummaryList(group.assignmentScopeLabels, 'No scopes');
}

export function formatRolePermissionSummary(role: AccessRoleListRow): string {
  if (role.kind === 'system') {
    return readFriendlyAccessSummary(role.permissionKeys);
  }

  const friendlyLabel: string = readFriendlyAccessSummary(role.permissionKeys);
  if (friendlyLabel !== 'Custom') {
    return friendlyLabel;
  }

  const familyCount: number = countPermissionFamilies(role.permissionKeys);
  return familyCount === 1 ? '1 permission family' : `${familyCount} permission families`;
}

export function formatRoleUsageSummary(role: AccessRoleListRow): string {
  const parts: string[] = [];
  if (role.groupCount > 0) {
    parts.push(role.groupCount === 1 ? '1 group' : `${role.groupCount} groups`);
  }
  if (role.principalCount > 0) {
    parts.push(role.principalCount === 1 ? '1 user' : `${role.principalCount} users`);
  }
  if (parts.length > 0) {
    return parts.join(', ');
  }

  return role.assignmentCount === 0 ? 'Unused' : `${role.assignmentCount} assignments`;
}

export function formatAssignmentAccessSummary(
  assignment: AccessAssignmentSummary,
  roles: readonly AccessRoleSummary[],
): string {
  const role: AccessRoleSummary | undefined = roles.find(
    (candidate: AccessRoleSummary): boolean => candidate.id === assignment.roleId,
  );

  return role === undefined ? assignment.roleName : readFriendlyAccessSummary(role.permissionKeys);
}

export function formatAccessSummaryList(values: readonly string[], emptyLabel: string, limit: number = 2): string {
  if (values.length === 0) {
    return emptyLabel;
  }
  if (values.length <= limit) {
    return values.join(', ');
  }

  return `${values.slice(0, limit).join(', ')} +${values.length - limit} more`;
}

function countPermissionFamilies(permissionKeys: readonly PermissionKey[]): number {
  const labels: Set<string> = new Set<string>();
  for (const permissionKey of permissionKeys) {
    labels.add(readPermissionFamily(permissionKey).label);
  }

  return labels.size;
}
