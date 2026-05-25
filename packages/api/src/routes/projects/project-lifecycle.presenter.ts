import type { DeploymentSummary, ProjectLifecycleResponse } from '@compartment/contracts';
import type { ProjectLifecycleResult } from '../../services/project-lifecycle.service.types';
import { buildDeploymentSummary } from '../deployments/deployment.presenter';
import { buildEnvironmentSummary } from '../presenters/environment-summary.presenter';
import { buildProjectSummary } from '../presenters/project-summary.presenter';

export function buildProjectLifecycleResponse(result: ProjectLifecycleResult): ProjectLifecycleResponse {
  const deployments: DeploymentSummary[] = result.deployments.map(buildDeploymentSummary);

  return {
    action: result.action,
    deployments,
    environment: buildEnvironmentSummary(result.environment),
    project: buildProjectSummary(result.project),
    state: result.state,
  };
}
