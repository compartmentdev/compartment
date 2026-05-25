import type { PermissionKey } from '@compartment/contracts';

export const organizationAdminPathPermissionKeys: readonly PermissionKey[] = [
  'organization.user.invite',
  'organization.user.block',
  'organization.user.remove',
  'organization.user.credentials.reset',
  'organization.group.manage',
  'organization.role.manage',
];

export function hasOrganizationAdminPathPermissions(permissionKeys: readonly PermissionKey[]): boolean {
  return organizationAdminPathPermissionKeys.every((permissionKey: PermissionKey): boolean =>
    permissionKeys.includes(permissionKey),
  );
}
