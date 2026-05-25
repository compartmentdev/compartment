import type { FirstDeployOnboardingStatusKey } from '@compartment/contracts';
import type { DeploymentRow } from '../queries/deployments.query.types';
import { readFirstDeployFailureStatusText } from './onboarding-first-deploy-status-text.service';

export interface FirstDeployDeploymentStatusResolution {
  status: FirstDeployOnboardingStatusKey;
  statusText: string;
}

export function resolveFirstDeployDeploymentRowsStatus(
  deployments: readonly DeploymentRow[],
): FirstDeployDeploymentStatusResolution {
  if (deployments.length === 0) {
    return { status: 'deploy_pending', statusText: 'Waiting for first deploy.' };
  }
  const failedDeployment: DeploymentRow | undefined = deployments.find(isFailedDeployment);
  if (failedDeployment !== undefined) {
    return { status: 'deploy_failed', statusText: readFirstDeployFailureStatusText(failedDeployment.failureMessage) };
  }
  if (deployments.every(isSucceededDeployment)) {
    return { status: 'deploy_succeeded', statusText: 'First deploy completed.' };
  }

  return { status: 'deploy_pending', statusText: 'Deploying services.' };
}

function isFailedDeployment(deployment: DeploymentRow): boolean {
  return deployment.status === 'failed';
}

function isSucceededDeployment(deployment: DeploymentRow): boolean {
  return deployment.status === 'succeeded';
}
