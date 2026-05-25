import { defaultCompartmentEnvironmentName, type ProjectRouteTargetSummary } from '@compartment/contracts';
import type { DeploymentJoinedRow, EnvironmentRow } from '../queries/deployments.query.types';
import { compareEnvironmentNames } from './environment-order.service';

interface PrimaryProjectOverviewEnvironmentInput {
  activeDeployments: readonly DeploymentJoinedRow[];
  deployments: readonly DeploymentJoinedRow[];
  environments: readonly EnvironmentRow[];
  openTargets: readonly ProjectRouteTargetSummary[];
  routeUrl: string | null;
}

export function readPrimaryProjectOverviewEnvironmentName(input: PrimaryProjectOverviewEnvironmentInput): string {
  const routeEnvironmentName: string | null = readEnvironmentNameForPrimaryRoute(input.openTargets, input.routeUrl);
  if (routeEnvironmentName !== null) {
    return routeEnvironmentName;
  }

  const activeEnvironmentName: string | null = readPrimaryActiveEnvironmentName(input.activeDeployments);
  if (activeEnvironmentName !== null) {
    return activeEnvironmentName;
  }

  const latestDeploymentEnvironmentName: string | null = readLatestDeploymentEnvironmentName(input.deployments);
  if (latestDeploymentEnvironmentName !== null) {
    return latestDeploymentEnvironmentName;
  }

  return (
    input.environments.find(
      (environment: EnvironmentRow): boolean => environment.name === defaultCompartmentEnvironmentName,
    )?.name ??
    input.environments[0]?.name ??
    defaultCompartmentEnvironmentName
  );
}

function readEnvironmentNameForPrimaryRoute(
  openTargets: readonly ProjectRouteTargetSummary[],
  routeUrl: string | null,
): string | null {
  if (routeUrl !== null) {
    const routeTarget: ProjectRouteTargetSummary | undefined = openTargets.find(
      (target: ProjectRouteTargetSummary): boolean => target.routeUrl === routeUrl,
    );
    if (routeTarget !== undefined) {
      return routeTarget.environmentName;
    }
  }

  return openTargets[0]?.environmentName ?? null;
}

function readPrimaryActiveEnvironmentName(activeDeployments: readonly DeploymentJoinedRow[]): string | null {
  if (activeDeployments.length === 0) {
    return null;
  }

  const environmentNames: string[] = [...new Set(activeDeployments.map(readDeploymentEnvironmentName))];
  environmentNames.sort(compareEnvironmentNames);
  return environmentNames[0] ?? null;
}

function readLatestDeploymentEnvironmentName(deployments: readonly DeploymentJoinedRow[]): string | null {
  const latestDeployment: DeploymentJoinedRow | null = deployments.reduce(
    (selected: DeploymentJoinedRow | null, item: DeploymentJoinedRow): DeploymentJoinedRow =>
      selected === null || item.deployment.createdAt > selected.deployment.createdAt ? item : selected,
    null,
  );

  return latestDeployment?.environment.name ?? null;
}

function readDeploymentEnvironmentName(deployment: DeploymentJoinedRow): string {
  return deployment.environment.name;
}
