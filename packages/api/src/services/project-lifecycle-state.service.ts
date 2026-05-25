import type { ProjectLifecycleState } from '@compartment/contracts';
import type { DeploymentJoinedRow } from '../queries/deployments.query.types';
import { hasReusableDeploymentImage } from './deployment-reusable-image-state.service';

export function readProjectLifecycleState(
  deployments: DeploymentJoinedRow[],
  activeDeployments: DeploymentJoinedRow[],
): ProjectLifecycleState {
  if (deployments.length === 0) {
    return 'not_deployed';
  }
  if (deployments.some(isAttentionDeployment) || activeDeployments.some(isAttentionDeployment)) {
    return 'needs_attention';
  }
  if (deployments.some(isUpdatingDeployment)) {
    return 'updating';
  }
  if (activeDeployments.length > 0) {
    return 'running';
  }
  if (deployments.every(isLifecycleStoppedDeployment)) {
    return 'stopped';
  }

  return 'needs_attention';
}

export function isReusableStoppedDeployment(deployment: DeploymentJoinedRow): boolean {
  return isLifecycleStoppedDeployment(deployment) && hasReusableDeploymentImage(deployment);
}

function isAttentionDeployment(deployment: DeploymentJoinedRow): boolean {
  if (isArchiveStoppedDeployment(deployment)) {
    return false;
  }

  return deployment.deployment.status === 'failed' || deployment.deployment.health === 'unhealthy';
}

function isUpdatingDeployment(deployment: DeploymentJoinedRow): boolean {
  if (isArchiveStoppedDeployment(deployment)) {
    return false;
  }

  const promotionStage: string = deployment.deployment.promotionStage;

  return (
    deployment.deployment.status === 'queued' ||
    deployment.deployment.status === 'running' ||
    deployment.deployment.health === 'pending' ||
    (promotionStage !== 'active' && promotionStage !== 'stopped')
  );
}

function isLifecycleStoppedDeployment(deployment: DeploymentJoinedRow): boolean {
  return isStoppedDeployment(deployment) || isArchiveStoppedDeployment(deployment);
}

function isStoppedDeployment(deployment: DeploymentJoinedRow): boolean {
  return deployment.deployment.status === 'stopped' && deployment.deployment.promotionStage === 'stopped';
}

function isArchiveStoppedDeployment(deployment: DeploymentJoinedRow): boolean {
  // Archive teardown previously persisted reusable stopped deployments as inactive rolled-back rows.
  return (
    !deployment.deployment.isActive &&
    deployment.deployment.status === 'succeeded' &&
    deployment.deployment.health === 'unhealthy' &&
    deployment.deployment.promotionStage === 'rolled_back'
  );
}
