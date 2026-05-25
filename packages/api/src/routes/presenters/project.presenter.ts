import type {
  ProjectEnvironmentOverview,
  ProjectListResponse,
  ProjectOverviewResponse,
  ProjectOverviewSummary,
  ProjectReadResponse,
  ProjectResponse,
  ProjectServiceOverview,
} from '@compartment/contracts';
import type { ProjectSummaryInput } from '../../services/presenter.types';
import type {
  ProjectEnvironmentOverviewItem,
  ProjectListResult,
  ProjectOverviewListItem,
  ProjectOverviewResult,
  ProjectReadResult,
  ProjectServiceOverviewItem,
} from '../../services/projects.service.types';
import { toNullableIsoString } from './date.presenter';
import { buildProjectSummary } from './project-summary.presenter';

export function buildProjectReadResponse(input: ProjectReadResult): ProjectReadResponse {
  return {
    project: buildProjectSummary(input.project),
    remoteState: input.remoteState,
  };
}

export function buildProjectOverviewResponse(input: ProjectOverviewResult): ProjectOverviewResponse {
  return {
    environments: input.environments.map(buildProjectEnvironmentOverview),
    project: buildProjectOverviewSummary(input.project),
  };
}

export function buildProjectResponse(project: ProjectSummaryInput): ProjectResponse {
  return {
    project: buildProjectSummary(project),
  };
}

export function buildProjectListResponse(result: ProjectListResult): ProjectListResponse {
  if (result.detail === 'overview') {
    return {
      detail: 'overview',
      pagination: result.pagination,
      projects: result.projects.map(buildProjectOverviewSummary),
    };
  }
  if (result.detail === 'status') {
    return {
      detail: 'status',
      projects: result.projects,
    };
  }

  return {
    detail: 'summary',
    pagination: result.pagination,
    projects: result.projects.map(buildProjectSummary),
  };
}

function buildProjectOverviewSummary(project: ProjectOverviewListItem): ProjectOverviewSummary {
  return {
    ...buildProjectSummary(project),
    canManageArchive: project.canManageArchive,
    canReadDeployments: project.canReadDeployments,
    canManageLifecycle: project.canManageLifecycle,
    environmentName: project.environmentName,
    lastDeploymentCreatedAt: toNullableIsoString(project.lastDeploymentCreatedAt),
    lifecycleAction: project.lifecycleAction,
    lifecycleDisabledReason: project.lifecycleDisabledReason,
    lifecycleState: project.lifecycleState,
    openTargets: project.openTargets,
    routeUrl: project.routeUrl,
    serviceCount: project.serviceCount,
    status: project.status,
  };
}

function buildProjectEnvironmentOverview(input: ProjectEnvironmentOverviewItem): ProjectEnvironmentOverview {
  return {
    name: input.name,
    services: input.services.map(buildProjectServiceOverview),
    status: input.status,
  };
}

function buildProjectServiceOverview(input: ProjectServiceOverviewItem): ProjectServiceOverview {
  return {
    kind: input.kind,
    lastDeploymentCreatedAt: toNullableIsoString(input.lastDeploymentCreatedAt),
    name: input.name,
    routeUrl: input.routeUrl,
    status: input.status,
  };
}
