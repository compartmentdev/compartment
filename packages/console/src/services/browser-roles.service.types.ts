import type { AccessRoleListRow, AccessRoleSummary, PermissionKey } from '@compartment/contracts';
import type { BrowserConsoleOrganizationContext } from './browser-organization-context.service.types';
import type { BrowserOrganizationOption } from './browser-organization.service.types';

export interface BrowserRolesPageResult {
  backHref?: string | undefined;
  currentOrganizationPermissions: PermissionKey[];
  errorMessage?: string | undefined;
  noticeMessage?: string | undefined;
  organizationContext: BrowserConsoleOrganizationContext;
  organizations: BrowserOrganizationOption[];
  permissionKeys: PermissionKey[];
  principalEmail: string;
  role: AccessRoleSummary | null;
  roleId: string | null;
  roles: AccessRoleListRow[];
  mode: 'create' | 'detail' | 'edit' | 'list';
  selectedOrganizationSlug: string | null;
  showOrganizationSelector: boolean;
}
