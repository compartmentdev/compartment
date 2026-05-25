import type { PermissionKey } from '@compartment/contracts/browser';
import { buildBrowserConsoleProjectsHref } from './console-hrefs';

export function buildUsersAdminRequiredRedirectTarget(selectedOrganizationSlug: string | null): string {
  return buildBrowserConsoleProjectsHref(selectedOrganizationSlug, [{ name: 'notice', value: 'users_admin_required' }]);
}

export function buildAuditReadRequiredRedirectTarget(selectedOrganizationSlug: string | null): string {
  return buildBrowserConsoleProjectsHref(selectedOrganizationSlug, [{ name: 'notice', value: 'audit_read_required' }]);
}

export function canReadBrowserUsers(permissions: PermissionKey[]): boolean {
  return permissions.includes('organization.user.read');
}

export function canInviteBrowserUsers(permissions: PermissionKey[]): boolean {
  return permissions.includes('organization.user.invite');
}

export function canBlockBrowserUsers(permissions: PermissionKey[]): boolean {
  return permissions.includes('organization.user.block');
}

export function canRemoveBrowserUsers(permissions: PermissionKey[]): boolean {
  return permissions.includes('organization.user.remove');
}

export function canReadBrowserGroups(permissions: PermissionKey[]): boolean {
  return hasAnyPermission(permissions, ['organization.group.read', 'organization.group.manage']);
}

export function canManageBrowserGroups(permissions: PermissionKey[]): boolean {
  return permissions.includes('organization.group.manage');
}

export function canReadBrowserRoles(permissions: PermissionKey[]): boolean {
  return hasAnyPermission(permissions, ['organization.role.read', 'organization.role.manage']);
}

export function canManageBrowserRoles(permissions: PermissionKey[]): boolean {
  return permissions.includes('organization.role.manage');
}

export function canReadBrowserAuditLogs(permissions: PermissionKey[]): boolean {
  return permissions.includes('organization.audit.read');
}

export function canRollbackBrowserDeployments(permissions: PermissionKey[]): boolean {
  return permissions.includes('deployment.rollback');
}

function hasAnyPermission(permissions: PermissionKey[], required: PermissionKey[]): boolean {
  return required.some((permission: PermissionKey): boolean => permissions.includes(permission));
}
