import type { DeploymentListResponse } from '@compartment/contracts';
import type { DeploymentListResult } from '../../services/deployment-movement.service.types';
import {
  buildDeploymentReadEnvironmentSummary,
  buildDeploymentReadProjectSummary,
  buildDeploymentReadSummary,
} from '../deployments/deployment-read.presenter';

export function buildDeploymentListResponse(result: DeploymentListResult): DeploymentListResponse {
  return {
    deployments: result.deployments.map(buildDeploymentReadSummary),
    environment: buildDeploymentReadEnvironmentSummary(result.environment),
    project: buildDeploymentReadProjectSummary(result.project),
  };
}
