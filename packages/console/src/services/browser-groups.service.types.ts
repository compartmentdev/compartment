import type {
  AccessAssignmentSummary,
  AccessAssignmentScopeProjectOption,
  AccessGroupListRow,
  AccessGroupMemberSummary,
  AccessRoleListRow,
  PermissionKey,
} from '@compartment/contracts';
import type { BrowserConsoleOrganizationContext } from './browser-organization-context.service.types';
import type { BrowserOrganizationOption } from './browser-organization.service.types';
import type { BrowserTablePageSize, BrowserTableSortDirection } from './browser-table.service.types';

export type BrowserGroupsSortBy = 'assignmentCount' | 'memberCount' | 'name';
export type BrowserGroupsSortDirection = BrowserTableSortDirection;
export type BrowserGroupsPageSize = BrowserTablePageSize;

export interface BrowserGroupsPageResult {
  assignments: AccessAssignmentSummary[];
  currentOrganizationPermissions: PermissionKey[];
  errorMessage?: string | undefined;
  groups: AccessGroupListRow[];
  mode: 'create' | 'detail' | 'list';
  members: AccessGroupMemberSummary[];
  noticeMessage?: string | undefined;
  organizationContext: BrowserConsoleOrganizationContext;
  organizations: BrowserOrganizationOption[];
  page: number;
  pageSize: BrowserGroupsPageSize;
  pageSizeOptions: BrowserGroupsPageSize[];
  principalEmail: string;
  projectCount?: number | undefined;
  roles: AccessRoleListRow[];
  searchQuery: string;
  scopeProjects: AccessAssignmentScopeProjectOption[];
  selectedGroup?: AccessGroupListRow | null | undefined;
  selectedGroupId: string | null;
  selectedOrganizationSlug: string | null;
  showOrganizationSelector: boolean;
  sortBy: BrowserGroupsSortBy;
  sortDirection: BrowserGroupsSortDirection;
  totalGroups: number;
  totalPages: number;
}
