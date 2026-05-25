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
  principalEmail: string;
  roles: AccessRoleListRow[];
  scopeProjects: AccessAssignmentScopeProjectOption[];
  selectedGroupId: string | null;
  selectedOrganizationSlug: string | null;
  showOrganizationSelector: boolean;
}
