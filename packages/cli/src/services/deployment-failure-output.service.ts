import type { DeploymentLogsResponse, DeploymentReadSummary } from '@compartment/contracts';

export function appendFailedDeploymentGuidance(baseMessage: string, deployments: DeploymentReadSummary[]): string {
  const includeServicePrefix: boolean = deployments.length > 1;
  const lines: string[] = deployments.flatMap((deployment: DeploymentReadSummary): string[] => {
    if (deployment.status !== 'failed') {
      return [];
    }
    const prefix: string = includeServicePrefix ? `[${deployment.serviceName}] ` : '';
    return [
      `${prefix}Failure: ${deployment.failureMessage ?? `Deployment failed during ${deployment.promotionStage}.`}`,
      `${prefix}See: compartment deployment logs --run ${deployment.deploymentRunId}`,
    ];
  });
  return lines.length === 0 ? baseMessage : `${baseMessage}\n${lines.join('\n')}`;
}

export function buildHistoricalLogsNotice(response: DeploymentLogsResponse): string | null {
  const historicalDeployment: DeploymentReadSummary | undefined = response.deployments.find(
    (deployment: DeploymentReadSummary): boolean => !deployment.isActive,
  );
  if (historicalDeployment === undefined) {
    return null;
  }
  const statusLabel: string =
    historicalDeployment.status === 'failed' ? 'failed deployment' : `${historicalDeployment.status} deployment`;
  return `Showing logs of ${statusLabel} ${historicalDeployment.id} from ${historicalDeployment.createdAt}. See: compartment deployment logs --run ${historicalDeployment.deploymentRunId}`;
}

export function joinDeploymentLogsOutput(details: string, lines: string): string {
  if (details === '') {
    return lines;
  }
  return lines === '' ? details : `${details}\n\n${lines}`;
}

export function readFailureStageText(deployment: DeploymentReadSummary): string {
  return deployment.status === 'failed' ? ` (${deployment.promotionStage})` : '';
}
