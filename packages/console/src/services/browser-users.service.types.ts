import type {
  AccessAssignmentScopeProjectOption,
  AccessGroupListRow,
  AccessRoleListRow,
  OrganizationUserListRow,
  PermissionKey,
  UserAccessDetail,
} from '@compartment/contracts';
import type { BrowserConsoleOrganizationContext } from './browser-organization-context.service.types';
import type { BrowserOrganizationOption } from './browser-organization.service.types';
import type { BrowserTablePageSize, BrowserTableSortDirection } from './browser-table.service.types';

export type BrowserUsersAccountStatus = 'active' | 'invited';
export type BrowserUsersAccessState = 'allowed' | 'blocked';
export type BrowserUsersSortBy = 'email' | 'status';
export type BrowserUsersSortDirection = BrowserTableSortDirection;
export type BrowserUsersPageSize = BrowserTablePageSize;
export type BrowserUsersUserType = 'user' | 'automation';

export type BrowserUsersUser = OrganizationUserListRow;

export interface BrowserUsersPageResult {
  availableGroups: AccessGroupListRow[];
  availableRoles: AccessRoleListRow[];
  currentOrganizationPermissions: PermissionKey[];
  errorMessage?: string | undefined;
  mode: 'create' | 'detail' | 'list';
  noticeMessage?: string | undefined;
  organizationContext: BrowserConsoleOrganizationContext;
  organizations: BrowserOrganizationOption[];
  page: number;
  pageSize: BrowserUsersPageSize;
  pageSizeOptions: BrowserUsersPageSize[];
  principalEmail: string;
  projectCount?: number | undefined;
  searchQuery: string;
  selectedUserAccess: UserAccessDetail | null;
  selectedUserEmail: string | null;
  selectedOrganizationSlug: string | null;
  showOrganizationSelector: boolean;
  scopeProjects: AccessAssignmentScopeProjectOption[];
  sortBy: BrowserUsersSortBy;
  sortDirection: BrowserUsersSortDirection;
  totalPages: number;
  totalUsers: number;
  users: BrowserUsersUser[];
}
