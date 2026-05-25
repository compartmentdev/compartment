import type { DeploymentLogsResponse, DeploymentReadSummary, DeploymentStatusResponse } from '@compartment/contracts';
import { readDeploymentDurationLabel } from '../../services/deployment-duration.service';

interface BuildVerboseDeploymentDetailsInput {
  displayedDeployments: DeploymentReadSummary[];
  environmentName: string;
  projectName: string;
  response: DeploymentLogsResponse | DeploymentStatusResponse;
}

export function buildVerboseDeploymentDetails(input: BuildVerboseDeploymentDetailsInput): string {
  const deployment: DeploymentReadSummary | null = readDetailsDeployment(input.response, input.displayedDeployments);
  if (deployment === null) {
    if ('deployments' in input.response && input.response.deployments.length > 0) {
      return buildMultiDeploymentDetails(input.projectName, input.environmentName, input.response.deployments).join(
        '\n',
      );
    }

    return buildProjectDetails(input.projectName, input.environmentName).join('\n');
  }

  return buildDeploymentDetails(input.projectName, input.environmentName, deployment).join('\n');
}

function readDetailsDeployment(
  response: DeploymentLogsResponse | DeploymentStatusResponse,
  displayedDeployments: DeploymentReadSummary[],
): DeploymentReadSummary | null {
  if ('lines' in response) {
    return response.deployments.length === 1 ? response.deployments[0]! : null;
  }

  return displayedDeployments.length === 1 ? displayedDeployments[0]! : null;
}

function buildDeploymentDetails(
  projectName: string,
  environmentName: string,
  deployment: DeploymentReadSummary,
): string[] {
  return [
    ...buildProjectDetails(projectName, environmentName),
    `Service: ${deployment.serviceName}`,
    `Deployment: ${deployment.id}`,
    `Label: ${deployment.label ?? 'n/a'}`,
    `Status: ${deployment.status}`,
    `Promotion Stage: ${deployment.promotionStage}`,
    `Health: ${deployment.health}`,
    `Duration: ${readDeploymentDurationLabel(deployment, Date.now()) ?? 'n/a'}`,
    `Route: ${deployment.routeUrl ?? 'n/a'}`,
    `Queued At: ${deployment.operation.createdAt}`,
    `Completed At: ${deployment.operation.completedAt ?? 'n/a'}`,
    `Failure: ${deployment.failureMessage ?? 'n/a'}`,
  ];
}

function buildMultiDeploymentDetails(
  projectName: string,
  environmentName: string,
  deployments: DeploymentReadSummary[],
): string[] {
  return [
    ...buildProjectDetails(projectName, environmentName),
    `Services: ${deployments.map((deployment: DeploymentReadSummary): string => deployment.serviceName).join(', ')}`,
    `Deployments: ${deployments.length}`,
    ...deployments.flatMap((deployment: DeploymentReadSummary): string[] =>
      buildMultiDeploymentServiceDetails(deployment),
    ),
  ];
}

function buildMultiDeploymentServiceDetails(deployment: DeploymentReadSummary): string[] {
  return [
    `[${deployment.serviceName}] Deployment: ${deployment.id}`,
    `[${deployment.serviceName}] Label: ${deployment.label ?? 'n/a'}`,
    `[${deployment.serviceName}] Status: ${deployment.status}`,
    `[${deployment.serviceName}] Promotion Stage: ${deployment.promotionStage}`,
    `[${deployment.serviceName}] Health: ${deployment.health}`,
    `[${deployment.serviceName}] Duration: ${readDeploymentDurationLabel(deployment, Date.now()) ?? 'n/a'}`,
    `[${deployment.serviceName}] Route: ${deployment.routeUrl ?? 'n/a'}`,
    `[${deployment.serviceName}] Failure: ${deployment.failureMessage ?? 'n/a'}`,
  ];
}

function buildProjectDetails(projectName: string, environmentName: string): string[] {
  return [`Project: ${projectName}`, `Environment: ${environmentName}`];
}
