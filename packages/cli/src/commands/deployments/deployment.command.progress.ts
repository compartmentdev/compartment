import type { DeploymentReadSummary, DeploymentStatusResponse } from '@compartment/contracts';
import { readDeploymentDurationLabel } from '../../services/deployment-duration.service';
import { formatDeploymentLabelTag } from '../../services/deployment-label-output.service';

export function createDeploymentProgressSignature(deployments: DeploymentReadSummary[]): string {
  return deployments.map(createSingleDeploymentProgressSignature).join('|');
}

export function buildDeploymentProgressMessage(
  response: DeploymentStatusResponse,
  deployments: DeploymentReadSummary[],
  now: number,
): string {
  if (deployments.length === 1) {
    return buildSingleDeploymentProgressMessage(response, deployments[0]!, now);
  }

  return `Deploy ${response.project.name}/${response.environment.name}: ${deployments
    .map((deployment: DeploymentReadSummary): string => formatDeploymentProgressPart(deployment, now))
    .join('; ')}.`;
}

function createSingleDeploymentProgressSignature(deployment: DeploymentReadSummary): string {
  return [
    deployment.id,
    deployment.status,
    deployment.health,
    deployment.promotionStage,
    deployment.routeUrl ?? '',
    deployment.operation.completedAt ?? '',
  ].join(':');
}

function buildSingleDeploymentProgressMessage(
  response: DeploymentStatusResponse,
  deployment: DeploymentReadSummary,
  now: number,
): string {
  const durationLabel: string | null = readDeploymentDurationLabel(deployment, now);
  const routeText: string = deployment.routeUrl !== null ? ` Route: ${deployment.routeUrl}.` : '';
  const durationText: string = readProgressDurationText(durationLabel, deployment);

  return `Deploy ${response.project.name}/${response.environment.name} ${deployment.serviceName}${formatDeploymentLabelTag(
    deployment.label,
  )}: ${deployment.status} (${deployment.promotionStage})${durationText}.${routeText}`;
}

function formatDeploymentProgressPart(deployment: DeploymentReadSummary, now: number): string {
  const durationLabel: string | null = readDeploymentDurationLabel(deployment, now);
  const durationText: string = readProgressDurationText(durationLabel, deployment);
  const routeText: string = deployment.routeUrl !== null ? ` @ ${deployment.routeUrl}` : '';

  return `${deployment.serviceName}${formatDeploymentLabelTag(deployment.label)}=${deployment.status} (${deployment.promotionStage})${durationText}${routeText}`;
}

function readProgressDurationText(durationLabel: string | null, deployment: DeploymentReadSummary): string {
  if (durationLabel === null) {
    return '';
  }
  if (deployment.completedAt !== null) {
    return ` in ${durationLabel}`;
  }

  return `, elapsed ${durationLabel}`;
}
