import type { PermissionKey, ProjectLifecycleAction, ProjectLifecycleState } from '@compartment/contracts';
import type { BrowserConsoleOrganizationContext } from './browser-organization-context.service.types';
import type { BrowserOrganizationOption } from './browser-organization.service.types';
import type { BrowserTablePageSize, BrowserTableSortDirection } from './browser-table.service.types';

export type BrowserProjectsArchiveState = 'active' | 'archived';

export type BrowserProjectStatus = 'archived' | 'healthy' | 'needs_attention' | 'not_deployed' | 'stopped' | 'updating';

export type BrowserProjectsSortBy = 'lastDeploy' | 'project' | 'services' | 'status' | 'updated';

export type BrowserProjectsSortDirection = BrowserTableSortDirection;

export type BrowserProjectsPageSize = BrowserTablePageSize;

export type BrowserProjectLifecycleAction = ProjectLifecycleAction | null;

export type BrowserProjectLifecycleState = ProjectLifecycleState | null;

export interface BrowserProjectOpenTarget {
  environmentName: string;
  routeUrl: string;
  serviceName: string;
}

export interface BrowserProjectSummary {
  canManageArchive: boolean;
  canManageLifecycle: boolean;
  environmentName: string;
  id: string;
  lastDeploymentCreatedAt: string | null;
  lifecycleAction: BrowserProjectLifecycleAction;
  lifecycleDisabledReason: string | null;
  lifecycleState: BrowserProjectLifecycleState;
  name: string;
  openTargets: BrowserProjectOpenTarget[];
  routeUrl: string | null;
  serviceCount: number;
  status: BrowserProjectStatus;
  updatedAt: string;
}

export interface BrowserProjectsPageResult {
  projects: BrowserProjectSummary[];
  archiveState: BrowserProjectsArchiveState;
  currentOrganizationPermissions: PermissionKey[];
  errorMessage?: string | undefined;
  noticeMessage?: string | undefined;
  organizationContext: BrowserConsoleOrganizationContext;
  organizations: BrowserOrganizationOption[];
  page: number;
  pageSize: BrowserProjectsPageSize;
  pageSizeOptions: BrowserProjectsPageSize[];
  principalEmail: string;
  projectCount: number;
  searchQuery: string;
  selectedOrganizationSlug: string | null;
  showOrganizationSelector: boolean;
  sortBy: BrowserProjectsSortBy;
  sortDirection: BrowserProjectsSortDirection;
  startOnboarding?: boolean | undefined;
  totalProjects: number;
  totalPages: number;
}
