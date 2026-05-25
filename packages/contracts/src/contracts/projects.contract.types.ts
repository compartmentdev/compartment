import type { ListPagination, ListSortDirection } from './list.contract';
import type { ProjectLifecycleAction, ProjectLifecycleState } from './project-lifecycle.contract';
import type { CompartmentServiceKind } from './compartment-descriptor.contract';

export type ExistingProjectRemoteState = 'active' | 'disconnected';
export type ProjectRemoteState = ExistingProjectRemoteState | 'not_created';
export type ProjectArchiveState = 'active' | 'archived' | 'all';
export type ProjectListDetail = 'overview' | 'status' | 'summary';
export type ProjectListOrderBy = 'lastDeploymentCreatedAt' | 'name' | 'serviceCount' | 'status' | 'updatedAt';
export type ProjectOperationalStatus =
  | 'archived'
  | 'healthy'
  | 'needs_attention'
  | 'not_deployed'
  | 'stopped'
  | 'updating';
export type ProjectScopedOperationalStatus = 'healthy' | 'needs_attention' | 'not_deployed' | 'stopped' | 'updating';

export interface ProjectSummary {
  archivedAt: string | null;
  createdAt: string;
  id: string;
  name: string;
  organizationId: string;
  updatedAt: string;
}

export interface ProjectResponse {
  project: ProjectSummary;
}

export interface ProjectReadResponse {
  project: ProjectSummary;
  remoteState: ExistingProjectRemoteState;
}

export interface ProjectRouteTargetSummary {
  environmentName: string;
  routeUrl: string;
  serviceName: string;
}

export interface ProjectServiceOverview {
  kind: CompartmentServiceKind;
  lastDeploymentCreatedAt: string | null;
  name: string;
  routeUrl: string | null;
  status: ProjectScopedOperationalStatus;
}

export interface ProjectEnvironmentOverview {
  name: string;
  services: ProjectServiceOverview[];
  status: ProjectScopedOperationalStatus;
}

export interface ProjectDeleteResponse {
  projectName: string;
}

export interface ProjectSummaryListResponse {
  detail: 'summary';
  pagination: ListPagination;
  projects: ProjectSummary[];
}

export interface ProjectListQuery {
  archiveState?: ProjectArchiveState | undefined;
  detail?: ProjectListDetail | undefined;
  orderBy?: ProjectListOrderBy | undefined;
  page?: number | undefined;
  perPage?: number | undefined;
  projectIds?: string[] | undefined;
  search?: string | undefined;
  sort?: ListSortDirection | undefined;
}

export interface ProjectOverviewSummary extends ProjectSummary {
  canManageArchive: boolean;
  canReadDeployments: boolean;
  canManageLifecycle: boolean;
  environmentName: string;
  lastDeploymentCreatedAt: string | null;
  lifecycleAction: ProjectLifecycleAction | null;
  lifecycleDisabledReason: string | null;
  lifecycleState: ProjectLifecycleState | null;
  openTargets: ProjectRouteTargetSummary[];
  routeUrl: string | null;
  serviceCount: number;
  status: ProjectOperationalStatus;
}

export interface ProjectOverviewResponse {
  environments: ProjectEnvironmentOverview[];
  project: ProjectOverviewSummary;
}

export interface ProjectOverviewListResponse {
  detail: 'overview';
  pagination: ListPagination;
  projects: ProjectOverviewSummary[];
}

export interface ProjectStatusSummary {
  id: string;
  lifecycleAction: ProjectLifecycleAction | null;
  lifecycleDisabledReason: string | null;
  lifecycleState: ProjectLifecycleState | null;
  openTargets: ProjectRouteTargetSummary[];
  routeUrl: string | null;
  status: ProjectOperationalStatus;
}

export interface ProjectStatusListResponse {
  detail: 'status';
  projects: ProjectStatusSummary[];
}

export type ProjectListResponse = ProjectOverviewListResponse | ProjectStatusListResponse | ProjectSummaryListResponse;

export interface RenameProjectRequest {
  name: string;
}

export interface ProjectShowResponse {
  descriptorFile: string | null;
  localProjectName: string | null;
  project: ProjectSummary | null;
  remoteState: ProjectRemoteState;
}
