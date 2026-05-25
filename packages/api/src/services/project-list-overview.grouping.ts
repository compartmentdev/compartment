import type { EnvironmentRow, ProjectServiceCountRow, DeploymentJoinedRow } from '../queries/deployments.query.types';
import {
  readLatestDeploymentsByEnvironmentService,
  sortDeploymentsByServiceName,
} from './deployment-selection.service';

export function groupLatestDeploymentsByProjectId(
  deployments: DeploymentJoinedRow[],
): Map<string, DeploymentJoinedRow[]> {
  return mapGroupedDeployments(deployments, readLatestDeploymentsByEnvironmentService);
}

export function groupActiveDeploymentsByProjectId(
  deployments: DeploymentJoinedRow[],
): Map<string, DeploymentJoinedRow[]> {
  return mapGroupedDeployments(deployments, sortDeploymentsByServiceName);
}

export function groupServiceCountsByProjectId(rows: ProjectServiceCountRow[]): Map<string, number> {
  return new Map(rows.map((row: ProjectServiceCountRow): [string, number] => [row.projectId, row.serviceCount]));
}

export function groupProjectEnvironmentsByProjectId(environments: EnvironmentRow[]): Map<string, EnvironmentRow[]> {
  const groupedEnvironments: Map<string, EnvironmentRow[]> = new Map<string, EnvironmentRow[]>();

  for (const environment of environments) {
    const projectEnvironments: EnvironmentRow[] = groupedEnvironments.get(environment.projectId) ?? [];
    projectEnvironments.push(environment);
    groupedEnvironments.set(environment.projectId, projectEnvironments);
  }

  return groupedEnvironments;
}

function mapGroupedDeployments(
  deployments: DeploymentJoinedRow[],
  mapItems: (deployments: DeploymentJoinedRow[]) => DeploymentJoinedRow[],
): Map<string, DeploymentJoinedRow[]> {
  const groupedDeployments: Map<string, DeploymentJoinedRow[]> = groupDeploymentsByProjectId(deployments);
  for (const [projectId, items] of groupedDeployments) {
    groupedDeployments.set(projectId, mapItems(items));
  }
  return groupedDeployments;
}

function groupDeploymentsByProjectId(deployments: DeploymentJoinedRow[]): Map<string, DeploymentJoinedRow[]> {
  const groupedDeployments: Map<string, DeploymentJoinedRow[]> = new Map<string, DeploymentJoinedRow[]>();
  for (const deployment of deployments) {
    const projectDeployments: DeploymentJoinedRow[] = groupedDeployments.get(deployment.project.id) ?? [];
    projectDeployments.push(deployment);
    groupedDeployments.set(deployment.project.id, projectDeployments);
  }
  return groupedDeployments;
}
