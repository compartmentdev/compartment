import { type ProjectScopedOperationalStatus } from '@compartment/contracts';
import { listProjectServicesByProjectId } from '../queries/deployment-context.query';
import type { DeploymentJoinedRow, EnvironmentRow, ProjectServiceRow } from '../queries/deployments.query.types';
import { compareEnvironmentNames } from './environment-order.service';
import { readProjectLifecycleState } from './project-lifecycle-state.service';
import {
  buildProjectOverviewSummary,
  buildProjectLiveContext,
  type ProjectOverviewContext,
  resolveVisibleProjectOverviewState,
  type ProjectLiveContext,
  type VisibleProjectOverviewState,
} from './project-list-overview.service';
import { readProjectScopedOperationalStatus } from './project-operational-status.service';
import { canReadProjectOverviewState } from './project-overview-lifecycle.service';
import { readProjectOverviewRouteUrl, type ProjectOverviewRouteContext } from './project-overview-route.service';
import { resolveRequiredProjectScope } from './project-scope.service';
import type { ResolvedProjectScope } from './project-scope.service.types';
import { requireVisibleProjectSummary, type VisibleProjectSummary } from './project-visibility.service';
import type {
  ProjectEnvironmentOverviewItem,
  ProjectOverviewListItem,
  ProjectOverviewResult,
  ProjectScopeInput,
  ProjectServiceOverviewItem,
} from './projects.service.types';

interface ProjectEnvironmentOverviewStateContext {
  activeDeploymentsByEnvironment: Map<string, DeploymentJoinedRow[]>;
  activeDeploymentsByOwner: Map<string, DeploymentJoinedRow[]>;
  latestDeploymentsByEnvironment: Map<string, DeploymentJoinedRow[]>;
  latestDeploymentsByOwner: Map<string, DeploymentJoinedRow>;
}

export async function getProjectOverviewForPrincipal(input: ProjectScopeInput): Promise<ProjectOverviewResult> {
  const projectScope: ResolvedProjectScope = await resolveRequiredProjectScope(
    input.principalId,
    input.organizationSlug,
    input.projectName,
  );
  const visibleProject: VisibleProjectSummary = await requireVisibleProjectSummary(
    projectScope.organization.id,
    input.principalId,
    projectScope.project,
  );
  const [services, liveContext] = await Promise.all([
    listProjectServicesByProjectId(projectScope.project.id),
    buildProjectLiveContext([projectScope.project]),
  ]);
  const projectSummary: ProjectOverviewListItem = buildProjectOverviewSummary(
    visibleProject,
    buildProjectOverviewSummaryContext(projectScope.project.id, services.length, liveContext),
  );

  return {
    environments: buildProjectEnvironmentOverviews(visibleProject, services, liveContext),
    project: projectSummary,
  };
}

function buildProjectOverviewSummaryContext(
  projectId: string,
  serviceCount: number,
  liveContext: ProjectLiveContext,
): ProjectOverviewContext {
  return {
    ...liveContext,
    serviceCountsByProjectId: new Map<string, number>([[projectId, serviceCount]]),
  };
}

function buildProjectEnvironmentOverviews(
  project: VisibleProjectSummary,
  services: ProjectServiceRow[],
  liveContext: ProjectLiveContext,
): ProjectEnvironmentOverviewItem[] {
  if (!canReadProjectOverviewState(project)) {
    return [];
  }

  const visibleState: VisibleProjectOverviewState = resolveVisibleProjectOverviewState(project, liveContext);
  const orderedServices: ProjectServiceRow[] = sortProjectServices(services);
  const routeContext: ProjectOverviewRouteContext = liveContext.routeContext;
  const environments: readonly string[] = readProjectOverviewEnvironmentNames(visibleState);
  const stateContext: ProjectEnvironmentOverviewStateContext =
    buildProjectEnvironmentOverviewStateContext(visibleState);
  return environments.map(
    (environmentName: string): ProjectEnvironmentOverviewItem =>
      buildProjectEnvironmentOverview(
        environmentName,
        orderedServices,
        stateContext,
        project.project.archivedAt === null,
        routeContext,
      ),
  );
}

function readProjectOverviewEnvironmentNames(visibleState: VisibleProjectOverviewState): readonly string[] {
  return sortEnvironmentNames(visibleState.environments.map((environment: EnvironmentRow): string => environment.name));
}

function buildProjectEnvironmentOverviewStateContext(
  visibleState: VisibleProjectOverviewState,
): ProjectEnvironmentOverviewStateContext {
  return {
    activeDeploymentsByEnvironment: groupDeploymentsByEnvironmentName(visibleState.activeDeployments),
    activeDeploymentsByOwner: buildActiveDeploymentsByOwner(visibleState.activeDeployments),
    latestDeploymentsByEnvironment: groupDeploymentsByEnvironmentName(visibleState.deployments),
    latestDeploymentsByOwner: buildLatestDeploymentsByOwner(visibleState.deployments),
  };
}

function buildProjectEnvironmentOverview(
  environmentName: string,
  services: ProjectServiceRow[],
  stateContext: ProjectEnvironmentOverviewStateContext,
  includeRouteTargets: boolean,
  routeContext: ProjectOverviewRouteContext,
): ProjectEnvironmentOverviewItem {
  return {
    name: environmentName,
    services: buildProjectServiceOverviews(
      environmentName,
      services,
      stateContext.latestDeploymentsByOwner,
      stateContext.activeDeploymentsByOwner,
      includeRouteTargets,
      routeContext,
    ),
    status: readProjectScopedStatus(
      stateContext.latestDeploymentsByEnvironment.get(environmentName) ?? [],
      stateContext.activeDeploymentsByEnvironment.get(environmentName) ?? [],
    ),
  };
}

function buildProjectServiceOverviews(
  environmentName: string,
  services: ProjectServiceRow[],
  latestDeploymentsByOwner: ReadonlyMap<string, DeploymentJoinedRow>,
  activeDeploymentsByOwner: ReadonlyMap<string, DeploymentJoinedRow[]>,
  includeRouteTargets: boolean,
  routeContext: ProjectOverviewRouteContext,
): ProjectServiceOverviewItem[] {
  return services.map(
    (service: ProjectServiceRow): ProjectServiceOverviewItem =>
      buildProjectServiceOverview(
        environmentName,
        service,
        latestDeploymentsByOwner,
        activeDeploymentsByOwner,
        includeRouteTargets,
        routeContext,
      ),
  );
}

function buildProjectServiceOverview(
  environmentName: string,
  service: ProjectServiceRow,
  latestDeploymentsByOwner: ReadonlyMap<string, DeploymentJoinedRow>,
  activeDeploymentsByOwner: ReadonlyMap<string, DeploymentJoinedRow[]>,
  includeRouteTargets: boolean,
  routeContext: ProjectOverviewRouteContext,
): ProjectServiceOverviewItem {
  const ownerKey: string = buildEnvironmentServiceKey(environmentName, service.name);
  const latestDeployment: DeploymentJoinedRow | undefined = latestDeploymentsByOwner.get(ownerKey);
  const activeDeployments: DeploymentJoinedRow[] = activeDeploymentsByOwner.get(ownerKey) ?? [];
  const routeUrl: string | null = includeRouteTargets
    ? readProjectOverviewRouteUrl(activeDeployments, routeContext)
    : null;

  return {
    kind: service.kind,
    lastDeploymentCreatedAt: latestDeployment?.deployment.createdAt ?? null,
    name: service.name,
    routeUrl,
    status: readProjectScopedStatus(latestDeployment === undefined ? [] : [latestDeployment], activeDeployments),
  };
}

function buildLatestDeploymentsByOwner(deployments: readonly DeploymentJoinedRow[]): Map<string, DeploymentJoinedRow> {
  return new Map<string, DeploymentJoinedRow>(
    deployments.map((deployment: DeploymentJoinedRow): [string, DeploymentJoinedRow] => [
      buildEnvironmentServiceKey(deployment.environment.name, deployment.service.name),
      deployment,
    ]),
  );
}

function buildActiveDeploymentsByOwner(
  deployments: readonly DeploymentJoinedRow[],
): Map<string, DeploymentJoinedRow[]> {
  const deploymentsByOwner: Map<string, DeploymentJoinedRow[]> = new Map<string, DeploymentJoinedRow[]>();

  for (const deployment of deployments) {
    const key: string = buildEnvironmentServiceKey(deployment.environment.name, deployment.service.name);
    const ownerDeployments: DeploymentJoinedRow[] = deploymentsByOwner.get(key) ?? [];
    ownerDeployments.push(deployment);
    deploymentsByOwner.set(key, ownerDeployments);
  }

  return deploymentsByOwner;
}

function groupDeploymentsByEnvironmentName(
  deployments: readonly DeploymentJoinedRow[],
): Map<string, DeploymentJoinedRow[]> {
  const deploymentsByEnvironment: Map<string, DeploymentJoinedRow[]> = new Map<string, DeploymentJoinedRow[]>();

  for (const deployment of deployments) {
    const environmentDeployments: DeploymentJoinedRow[] =
      deploymentsByEnvironment.get(deployment.environment.name) ?? [];
    environmentDeployments.push(deployment);
    deploymentsByEnvironment.set(deployment.environment.name, environmentDeployments);
  }

  return deploymentsByEnvironment;
}

function readProjectScopedStatus(
  deployments: readonly DeploymentJoinedRow[],
  activeDeployments: readonly DeploymentJoinedRow[],
): ProjectScopedOperationalStatus {
  return readProjectScopedOperationalStatus(readProjectLifecycleState([...deployments], [...activeDeployments]));
}

function buildEnvironmentServiceKey(environmentName: string, serviceName: string): string {
  return `${environmentName}:${serviceName}`;
}

function sortProjectServices(services: readonly ProjectServiceRow[]): ProjectServiceRow[] {
  return [...services].sort((left: ProjectServiceRow, right: ProjectServiceRow): number =>
    left.name.localeCompare(right.name),
  );
}

function sortEnvironmentNames(environmentNames: readonly string[]): string[] {
  return [...environmentNames].sort(compareEnvironmentNames);
}
