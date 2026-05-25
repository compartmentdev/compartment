import {
  type ProjectLifecycleAction,
  type ProjectLifecycleState,
  type ProjectOperationalStatus,
  type ProjectRouteTargetSummary,
} from '@compartment/contracts';
import {
  listProjectEnvironmentsByProjectIds,
  listProjectServiceCountsByProjectIds,
} from '../queries/deployment-context.query';
import {
  listActiveJoinedDeploymentsForProjects,
  listJoinedDeploymentsForProjects,
} from '../queries/deployment-joined.query';
import type { DeploymentJoinedRow, EnvironmentRow, ProjectServiceCountRow } from '../queries/deployments.query.types';
import type { ProjectRow } from '../queries/projects.query.types';
import { getApiConfig } from '../runtime/runtime-access';
import {
  groupActiveDeploymentsByProjectId,
  groupLatestDeploymentsByProjectId,
  groupProjectEnvironmentsByProjectId,
  groupServiceCountsByProjectId,
} from './project-list-overview.grouping';
import { readPrimaryProjectOverviewEnvironmentName } from './project-overview-environment.service';
import {
  canReadProjectOverviewState,
  canReadProjectRouteTargets,
  readCanReadDeployments,
  readCanManageLifecycle,
  readProjectLifecycleOverview,
  type ProjectLifecycleOverview,
} from './project-overview-lifecycle.service';
import {
  buildProjectOverviewRouteContext,
  readLastDeploymentCreatedAt,
  readProjectOverviewRouteTargets,
  readProjectOverviewRouteUrl,
  type ProjectOverviewRouteContext,
} from './project-overview-route.service';
import type { VisibleProjectSummary } from './project-visibility.service';
import { buildProjectSummaryListItem } from './project-summary-list-item.service.helpers';
import type { ProjectOverviewListItem } from './projects.service.types';

interface ProjectOverviewInput {
  projects: VisibleProjectSummary[];
}

export interface ProjectLiveContext {
  activeDeploymentsByProjectId: Map<string, DeploymentJoinedRow[]>;
  deploymentsByProjectId: Map<string, DeploymentJoinedRow[]>;
  environmentsByProjectId: Map<string, EnvironmentRow[]>;
  routeContext: ProjectOverviewRouteContext;
}

export interface ProjectOverviewContext extends ProjectLiveContext {
  serviceCountsByProjectId: Map<string, number>;
}
export interface VisibleProjectOverviewState {
  activeDeployments: DeploymentJoinedRow[];
  deployments: DeploymentJoinedRow[];
  environments: EnvironmentRow[];
  lastDeploymentCreatedAt: Date | null;
  openTargets: ProjectRouteTargetSummary[];
  routeUrl: string | null;
  serviceCount: number;
}

interface VisibleProjectRouteState {
  openTargets: ProjectRouteTargetSummary[];
  routeUrl: string | null;
}

interface ProjectOverviewCapabilityFields {
  canManageArchive: boolean;
  canReadDeployments: boolean;
  canManageLifecycle: boolean;
}
interface ProjectOverviewLifecycleFields {
  lifecycleAction: ProjectLifecycleAction | null;
  lifecycleDisabledReason: string | null;
  lifecycleState: ProjectLifecycleState | null;
  status: ProjectOperationalStatus;
}

export async function buildProjectOverviewSummaries(input: ProjectOverviewInput): Promise<ProjectOverviewListItem[]> {
  const context: ProjectOverviewContext = await buildProjectOverviewContext(input.projects);
  return input.projects.map(
    (project: VisibleProjectSummary): ProjectOverviewListItem => buildProjectOverviewSummary(project, context),
  );
}

async function buildProjectOverviewContext(projects: VisibleProjectSummary[]): Promise<ProjectOverviewContext> {
  const projectRows: ProjectRow[] = projects.map(readProjectRow);
  const projectIds: string[] = readProjectIds(projectRows);
  const [serviceCounts, liveContext]: [ProjectServiceCountRow[], ProjectLiveContext] = await Promise.all([
    listProjectServiceCountsByProjectIds(projectIds),
    buildProjectLiveContext(projectRows),
  ]);

  return {
    ...liveContext,
    serviceCountsByProjectId: groupServiceCountsByProjectId(serviceCounts),
  };
}

export async function buildProjectLiveContext(projects: ProjectRow[]): Promise<ProjectLiveContext> {
  const projectIds: string[] = readProjectIds(projects);
  const activeProjectIds: string[] = readActiveProjectIds(projects);
  const [deployments, activeDeployments, routeContext, environments]: [
    DeploymentJoinedRow[],
    DeploymentJoinedRow[],
    ProjectOverviewRouteContext,
    EnvironmentRow[],
  ] = await Promise.all([
    listProjectOverviewDeployments(activeProjectIds),
    listProjectOverviewActiveDeployments(activeProjectIds),
    buildProjectOverviewRouteContext(activeProjectIds),
    listProjectEnvironmentsByProjectIds(projectIds),
  ]);

  return {
    activeDeploymentsByProjectId: groupActiveDeploymentsByProjectId(activeDeployments),
    deploymentsByProjectId: groupLatestDeploymentsByProjectId(deployments),
    environmentsByProjectId: groupProjectEnvironmentsByProjectId(environments),
    routeContext,
  };
}

async function listProjectOverviewDeployments(projectIds: string[]): Promise<DeploymentJoinedRow[]> {
  if (projectIds.length === 0) {
    return [];
  }

  return await listJoinedDeploymentsForProjects(projectIds, getApiConfig().baseDomain);
}

async function listProjectOverviewActiveDeployments(projectIds: string[]): Promise<DeploymentJoinedRow[]> {
  if (projectIds.length === 0) {
    return [];
  }

  return await listActiveJoinedDeploymentsForProjects(projectIds, getApiConfig().baseDomain);
}

function readProjectIds(projects: readonly ProjectRow[]): string[] {
  return projects.map((project: ProjectRow): string => project.id);
}

function readProjectRow(project: VisibleProjectSummary): ProjectRow {
  return project.project;
}

function readActiveProjectIds(projects: readonly ProjectRow[]): string[] {
  return projects
    .filter((project: ProjectRow): boolean => project.archivedAt === null)
    .map((project: ProjectRow): string => project.id);
}

export function buildProjectOverviewSummary(
  projectSummary: VisibleProjectSummary,
  context: ProjectOverviewContext,
): ProjectOverviewListItem {
  const project: ProjectRow = projectSummary.project;
  const capabilities: ProjectOverviewCapabilityFields = buildProjectOverviewCapabilities(project, projectSummary);
  const overviewState: VisibleProjectOverviewState = resolveVisibleProjectOverviewState(projectSummary, context);
  const routeState: VisibleProjectRouteState = resolveVisibleProjectRouteState(projectSummary, context);
  const lifecycle: ProjectLifecycleOverview = readProjectLifecycleOverview(
    project,
    capabilities.canManageLifecycle,
    overviewState.deployments,
    overviewState.activeDeployments,
  );

  return {
    ...buildProjectSummaryListItem(project),
    ...capabilities,
    ...buildProjectOverviewLifecycleFields(lifecycle),
    environmentName: readPrimaryProjectOverviewEnvironmentName({ ...overviewState, ...routeState }),
    lastDeploymentCreatedAt: overviewState.lastDeploymentCreatedAt,
    openTargets: routeState.openTargets,
    routeUrl: routeState.routeUrl,
    serviceCount: overviewState.serviceCount,
  };
}

export function resolveVisibleProjectOverviewState(
  projectSummary: VisibleProjectSummary,
  context: ProjectOverviewContext | ProjectLiveContext,
): VisibleProjectOverviewState {
  const project: ProjectRow = projectSummary.project;
  const environments: EnvironmentRow[] = context.environmentsByProjectId.get(project.id) ?? [];
  if (!canReadProjectOverviewState(projectSummary)) {
    return emptyVisibleProjectOverviewState(environments);
  }

  const deployments: DeploymentJoinedRow[] = context.deploymentsByProjectId.get(project.id) ?? [];
  const activeDeployments: DeploymentJoinedRow[] = context.activeDeploymentsByProjectId.get(project.id) ?? [];
  const openTargets: ProjectRouteTargetSummary[] =
    project.archivedAt === null ? readProjectOverviewRouteTargets(activeDeployments, context.routeContext) : [];

  return {
    activeDeployments,
    deployments,
    environments,
    lastDeploymentCreatedAt: readLastDeploymentCreatedAt(deployments),
    openTargets,
    routeUrl: readPrimaryProjectRouteUrl(project, activeDeployments, context.routeContext),
    serviceCount: 'serviceCountsByProjectId' in context ? (context.serviceCountsByProjectId.get(project.id) ?? 0) : 0,
  };
}

function emptyVisibleProjectOverviewState(environments: EnvironmentRow[]): VisibleProjectOverviewState {
  return {
    activeDeployments: [],
    deployments: [],
    environments,
    lastDeploymentCreatedAt: null,
    openTargets: [],
    routeUrl: null,
    serviceCount: 0,
  };
}

function resolveVisibleProjectRouteState(
  projectSummary: VisibleProjectSummary,
  context: ProjectOverviewContext | ProjectLiveContext,
): VisibleProjectRouteState {
  const project: ProjectRow = projectSummary.project;
  if (!canReadProjectRouteTargets(projectSummary) || project.archivedAt !== null) {
    return emptyVisibleProjectRouteState();
  }

  const activeDeployments: DeploymentJoinedRow[] = context.activeDeploymentsByProjectId.get(project.id) ?? [];

  return {
    openTargets: readProjectOverviewRouteTargets(activeDeployments, context.routeContext),
    routeUrl: readPrimaryProjectRouteUrl(project, activeDeployments, context.routeContext),
  };
}

function emptyVisibleProjectRouteState(): VisibleProjectRouteState {
  return {
    openTargets: [],
    routeUrl: null,
  };
}

function readPrimaryProjectRouteUrl(
  project: ProjectRow,
  activeDeployments: readonly DeploymentJoinedRow[],
  routeContext: ProjectOverviewRouteContext,
): string | null {
  if (project.archivedAt !== null) {
    return null;
  }

  return readProjectOverviewRouteUrl([...activeDeployments], routeContext);
}

function buildProjectOverviewCapabilities(
  project: ProjectRow,
  projectSummary: VisibleProjectSummary,
): ProjectOverviewCapabilityFields {
  return {
    canManageArchive: projectSummary.permissions.includes('project.archive'),
    canReadDeployments: readCanReadDeployments(projectSummary.permissions),
    canManageLifecycle: readCanManageLifecycle(project, projectSummary.permissions),
  };
}

function buildProjectOverviewLifecycleFields(lifecycle: ProjectLifecycleOverview): ProjectOverviewLifecycleFields {
  return {
    lifecycleAction: lifecycle.action,
    lifecycleDisabledReason: lifecycle.disabledReason,
    lifecycleState: lifecycle.state,
    status: lifecycle.status,
  };
}
