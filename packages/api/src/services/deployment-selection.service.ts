import type { DeploymentJoinedRow } from '../queries/deployments.query.types';

export function readLatestDeploymentsByService(deployments: DeploymentJoinedRow[]): DeploymentJoinedRow[] {
  const latestDeploymentsByService: Map<string, DeploymentJoinedRow> = new Map<string, DeploymentJoinedRow>();

  for (const deployment of deployments) {
    if (!latestDeploymentsByService.has(deployment.service.id)) {
      latestDeploymentsByService.set(deployment.service.id, deployment);
    }
  }

  return sortDeploymentsByServiceName([...latestDeploymentsByService.values()]);
}

export function readLatestDeploymentsByEnvironmentService(deployments: DeploymentJoinedRow[]): DeploymentJoinedRow[] {
  const latestDeploymentsByEnvironmentService: Map<string, DeploymentJoinedRow> = new Map<
    string,
    DeploymentJoinedRow
  >();

  for (const deployment of deployments) {
    const key: string = `${deployment.environment.id}:${deployment.service.id}`;
    if (!latestDeploymentsByEnvironmentService.has(key)) {
      latestDeploymentsByEnvironmentService.set(key, deployment);
    }
  }

  return sortDeploymentsByEnvironmentAndService([...latestDeploymentsByEnvironmentService.values()]);
}

export function sortDeploymentsByServiceName(deployments: DeploymentJoinedRow[]): DeploymentJoinedRow[] {
  return [...deployments].sort((left: DeploymentJoinedRow, right: DeploymentJoinedRow): number =>
    left.service.name.localeCompare(right.service.name),
  );
}

function sortDeploymentsByEnvironmentAndService(deployments: DeploymentJoinedRow[]): DeploymentJoinedRow[] {
  return [...deployments].sort((left: DeploymentJoinedRow, right: DeploymentJoinedRow): number => {
    const environmentComparison: number = left.environment.name.localeCompare(right.environment.name);
    if (environmentComparison !== 0) {
      return environmentComparison;
    }

    return left.service.name.localeCompare(right.service.name);
  });
}
