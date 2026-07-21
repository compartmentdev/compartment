import type {
  CompartmentServiceKind,
  ExistingProjectRemoteState,
  ListSortDirection,
  ProjectArchiveState,
  ProjectLifecycleAction,
  ProjectLifecycleState,
  ProjectListDetail,
  ProjectListOrderBy,
  ProjectOperationalStatus,
  ProjectRouteTargetSummary,
  ProjectScopedOperationalStatus,
} from '@compartment/contracts';
import type { ProjectRow } from '../queries/projects.query.types';
import type { ListPagination } from './list-pagination.service.helpers';

export interface ProjectScopeInput {
  organizationSlug: string;
  principalId: string;
  projectName: string;
}

export interface ListProjectsInput {
  archiveState?: ProjectArchiveState | undefined;
  detail?: ProjectListDetail | undefined;
  orderBy?: ProjectListOrderBy | undefined;
  organizationSlug: string;
  page?: number | undefined;
  perPage?: number | undefined;
  principalId: string;
  projectIds?: string[] | undefined;
  search?: string | undefined;
  sort?: ListSortDirection | undefined;
}

export interface ProjectSummaryListResult {
  detail: 'summary';
  pagination: ListPagination;
  projects: ProjectSummaryListItem[];
}

export interface ProjectOverviewListResult {
  detail: 'overview';
  pagination: ListPagination;
  projects: ProjectOverviewListItem[];
}

export interface ProjectStatusListResult {
  detail: 'status';
  projects: ProjectStatusListItem[];
}

export type ProjectListResult = ProjectOverviewListResult | ProjectStatusListResult | ProjectSummaryListResult;

export interface ProjectSummaryListItem {
  archivedAt: Date | null;
  createdAt: Date;
  id: string;
  name: string;
  organizationId: string;
  updatedAt: Date;
}

export interface ProjectOverviewListItem extends ProjectSummaryListItem {
  canManageArchive: boolean;
  canReadDeployments: boolean;
  canManageLifecycle: boolean;
  environmentName: string;
  lastDeploymentCreatedAt: Date | null;
  lifecycleAction: ProjectLifecycleAction | null;
  lifecycleDisabledReason: string | null;
  lifecycleState: ProjectLifecycleState | null;
  openTargets: ProjectRouteTargetSummary[];
  routeUrl: string | null;
  serviceCount: number;
  status: ProjectOperationalStatus;
}

export interface ProjectServiceOverviewItem {
  kind: CompartmentServiceKind;
  lastDeploymentCreatedAt: Date | null;
  name: string;
  routeUrl: string | null;
  status: ProjectScopedOperationalStatus;
}

export interface ProjectEnvironmentOverviewItem {
  name: string;
  services: ProjectServiceOverviewItem[];
  status: ProjectScopedOperationalStatus;
}

export interface ProjectOverviewResult {
  environments: ProjectEnvironmentOverviewItem[];
  project: ProjectOverviewListItem;
}

export interface ProjectStatusListItem {
  id: string;
  lifecycleAction: ProjectLifecycleAction | null;
  lifecycleDisabledReason: string | null;
  lifecycleState: ProjectLifecycleState | null;
  openTargets: ProjectRouteTargetSummary[];
  routeUrl: string | null;
  status: ProjectOperationalStatus;
}

export interface RenameProjectServiceInput extends ProjectScopeInput {
  nextProjectName: string;
}

export interface ProjectReadResult {
  project: ProjectRow;
  remoteState: ExistingProjectRemoteState;
}

export interface ProjectDeletePreparation {
  preparationLeaseId: string | null;
  project: ProjectRow;
  terminalFailureMessage: string | null;
}

export interface ProjectDeleteResult {
  projectName: string;
  recoveredTerminalFailureMessage: string | null;
}
