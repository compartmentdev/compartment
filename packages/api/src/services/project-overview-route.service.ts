import { type ProjectRouteTargetSummary } from '@compartment/contracts';
import { listActiveCustomDeploymentRoutesForProjects } from '../queries/custom-deployment-routes.query';
import type { DeploymentRouteLookupRow } from '../queries/deployment-routes.query.types';
import type { DeploymentJoinedRow } from '../queries/deployments.query.types';
import { getApiConfig } from '../runtime/runtime-access';
import { compareEnvironmentNames, readEnvironmentSortRank } from './environment-order.service';
import { buildPublicRouteUrl } from './public-hosts.service';

export interface ProjectOverviewRouteContext {
  customRouteHostByOwner: Map<string, string>;
}

interface ProjectRouteTargetEntry {
  environmentCreatedAt: Date;
  sourceIndex: number;
  target: ProjectRouteTargetSummary;
}

export async function buildProjectOverviewRouteContext(projectIds: string[]): Promise<ProjectOverviewRouteContext> {
  const customRoutes: DeploymentRouteLookupRow[] = await listActiveCustomDeploymentRoutesForProjects(projectIds);

  return {
    customRouteHostByOwner: groupCustomRouteHostsByOwner(customRoutes),
  };
}

export function readLastDeploymentCreatedAt(deployments: DeploymentJoinedRow[]): Date | null {
  const deployment: DeploymentJoinedRow | null = deployments.reduce(
    (latest: DeploymentJoinedRow | null, item: DeploymentJoinedRow): DeploymentJoinedRow =>
      latest === null || item.deployment.createdAt > latest.deployment.createdAt ? item : latest,
    null,
  );

  return deployment?.deployment.createdAt ?? null;
}

export function readProjectOverviewRouteUrl(
  activeDeployments: DeploymentJoinedRow[],
  routeContext: ProjectOverviewRouteContext,
): string | null {
  const routeHost: string | null = readPreferredRouteHost(activeDeployments, routeContext);

  return routeHost === null ? null : buildPublicRouteUrl({ host: routeHost }, getApiConfig());
}

export function readProjectOverviewRouteTargets(
  activeDeployments: DeploymentJoinedRow[],
  routeContext: ProjectOverviewRouteContext,
): ProjectRouteTargetSummary[] {
  const targets: ProjectRouteTargetEntry[] = [];
  let sourceIndex: number = 0;
  for (const ownerDeployments of groupDeploymentsByRouteOwner(activeDeployments).values()) {
    const target: ProjectRouteTargetSummary | null = readProjectOverviewRouteTarget(ownerDeployments, routeContext);
    if (target !== null) {
      targets.push({
        environmentCreatedAt: ownerDeployments[0]!.environment.createdAt,
        sourceIndex,
        target,
      });
    }
    sourceIndex += 1;
  }

  return targets
    .toSorted(compareProjectRouteTargets)
    .map((entry: ProjectRouteTargetEntry): ProjectRouteTargetSummary => entry.target);
}

function groupDeploymentsByRouteOwner(deployments: DeploymentJoinedRow[]): Map<string, DeploymentJoinedRow[]> {
  const deploymentsByOwner: Map<string, DeploymentJoinedRow[]> = new Map<string, DeploymentJoinedRow[]>();
  for (const deployment of deployments) {
    const ownerKey: string = buildRouteOwnerKey(deployment.environment.id, deployment.service.id);
    const ownerDeployments: DeploymentJoinedRow[] = deploymentsByOwner.get(ownerKey) ?? [];
    ownerDeployments.push(deployment);
    deploymentsByOwner.set(ownerKey, ownerDeployments);
  }

  return deploymentsByOwner;
}

function readProjectOverviewRouteTarget(
  activeDeployments: DeploymentJoinedRow[],
  routeContext: ProjectOverviewRouteContext,
): ProjectRouteTargetSummary | null {
  const deployment: DeploymentJoinedRow | undefined = activeDeployments[0];
  const routeHost: string | null = readPreferredRouteHost(activeDeployments, routeContext);
  if (deployment === undefined || routeHost === null) {
    return null;
  }

  return {
    environmentName: deployment.environment.name,
    routeUrl: buildPublicRouteUrl({ host: routeHost }, getApiConfig()),
    serviceName: deployment.service.name,
  };
}

function readPreferredRouteHost(
  activeDeployments: DeploymentJoinedRow[],
  routeContext: ProjectOverviewRouteContext,
): string | null {
  const deployment: DeploymentJoinedRow | null = readPrimaryRouteDeployment(activeDeployments);
  if (deployment === null) {
    return null;
  }

  const customRouteHost: string | undefined = routeContext.customRouteHostByOwner.get(
    buildRouteOwnerKey(deployment.environment.id, deployment.service.id),
  );

  return customRouteHost ?? deployment.deployment.routeHost;
}

function readPrimaryRouteDeployment(activeDeployments: DeploymentJoinedRow[]): DeploymentJoinedRow | null {
  return activeDeployments
    .filter((item: DeploymentJoinedRow): boolean => item.deployment.routeHost !== null)
    .reduce(
      (selected: DeploymentJoinedRow | null, item: DeploymentJoinedRow): DeploymentJoinedRow =>
        selected === null || comparePrimaryRouteDeployments(item, selected) < 0 ? item : selected,
      null,
    );
}

function groupCustomRouteHostsByOwner(customRoutes: DeploymentRouteLookupRow[]): Map<string, string> {
  const hostsByOwner: Map<string, string> = new Map<string, string>();
  for (const route of customRoutes) {
    const ownerKey: string = buildRouteOwnerKey(route.environmentId, route.serviceId);
    if (!hostsByOwner.has(ownerKey)) {
      hostsByOwner.set(ownerKey, route.host);
    }
  }

  return hostsByOwner;
}

function buildRouteOwnerKey(environmentId: string, serviceId: string): string {
  return `${environmentId}:${serviceId}`;
}

function compareProjectRouteTargets(left: ProjectRouteTargetEntry, right: ProjectRouteTargetEntry): number {
  const environmentRankComparison: number =
    readEnvironmentSortRank(left.target.environmentName) - readEnvironmentSortRank(right.target.environmentName);
  if (environmentRankComparison !== 0) {
    return environmentRankComparison;
  }

  const environmentCreatedAtComparison: number =
    left.environmentCreatedAt.getTime() - right.environmentCreatedAt.getTime();
  if (environmentCreatedAtComparison !== 0) {
    return environmentCreatedAtComparison;
  }

  return left.sourceIndex - right.sourceIndex;
}

function comparePrimaryRouteDeployments(left: DeploymentJoinedRow, right: DeploymentJoinedRow): number {
  return readFirstNonZeroComparison([
    readPrimaryRouteServiceKindRank(left) - readPrimaryRouteServiceKindRank(right),
    readPrimaryRouteServiceNameRank(left) - readPrimaryRouteServiceNameRank(right),
    countRouteHostLabels(left) - countRouteHostLabels(right),
    compareEnvironmentNames(left.environment.name, right.environment.name),
    left.service.name.localeCompare(right.service.name),
    left.deployment.routeHost!.localeCompare(right.deployment.routeHost!),
  ]);
}

function readPrimaryRouteServiceKindRank(deployment: DeploymentJoinedRow): number {
  switch (deployment.service.kind) {
    case 'web':
    case 'static':
      return 0;
    case 'api':
      return 1;
    case 'worker':
    case 'job':
    case 'cron':
      return 2;
  }
}

function readPrimaryRouteServiceNameRank(deployment: DeploymentJoinedRow): number {
  return deployment.service.name === 'web' ? 0 : 1;
}

function readFirstNonZeroComparison(comparisons: readonly number[]): number {
  return comparisons.find((comparison: number): boolean => comparison !== 0) ?? 0;
}

function countRouteHostLabels(deployment: DeploymentJoinedRow): number {
  const routeHost: string | null = deployment.deployment.routeHost;
  return routeHost === null ? Number.MAX_SAFE_INTEGER : routeHost.split('.').length;
}
