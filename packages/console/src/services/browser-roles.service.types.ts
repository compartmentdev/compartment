import type { AccessRoleListRow, AccessRoleSummary, PermissionKey } from '@compartment/contracts';
import type { BrowserConsoleOrganizationContext } from './browser-organization-context.service.types';
import type { BrowserOrganizationOption } from './browser-organization.service.types';
import type { BrowserTablePageSize, BrowserTableSortDirection } from './browser-table.service.types';

export type BrowserRolesSortBy = 'assignmentCount' | 'kind' | 'name';
export type BrowserRolesSortDirection = BrowserTableSortDirection;
export type BrowserRolesPageSize = BrowserTablePageSize;

export interface BrowserRolesPageResult {
  backHref?: string | undefined;
  currentOrganizationPermissions: PermissionKey[];
  errorMessage?: string | undefined;
  noticeMessage?: string | undefined;
  organizationContext: BrowserConsoleOrganizationContext;
  organizations: BrowserOrganizationOption[];
  page: number;
  pageSize: BrowserRolesPageSize;
  pageSizeOptions: BrowserRolesPageSize[];
  permissionKeys: PermissionKey[];
  principalEmail: string;
  projectCount?: number | undefined;
  role: AccessRoleSummary | null;
  roleId: string | null;
  roles: AccessRoleListRow[];
  mode: 'create' | 'detail' | 'edit' | 'list';
  searchQuery: string;
  selectedOrganizationSlug: string | null;
  showOrganizationSelector: boolean;
  sortBy: BrowserRolesSortBy;
  sortDirection: BrowserRolesSortDirection;
  totalPages: number;
  totalRoles: number;
}
