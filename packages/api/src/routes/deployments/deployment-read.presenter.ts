import type {
  DeploymentLogsResponse,
  DeploymentReadEnvironmentSummary,
  DeploymentReadOperationSummary,
  DeploymentReadProjectSummary,
  DeploymentReadSummary,
  DeploymentStatusResponse,
} from '@compartment/contracts';
import type {
  DeploymentLogsLookupResult,
  DeploymentStatusLookupResult,
} from '../../services/deployments.service.types';
import type {
  DeploymentSummaryInput,
  DeploymentReadEnvironmentSummaryInput,
  DeploymentReadProjectSummaryInput,
  OperationSummaryInput,
} from '../../services/presenter.types';
import { toNullableIsoString } from '../presenters/date.presenter';
import { buildDeploymentBaseSummary } from './deployment-summary.presenter';

export function buildDeploymentReadStatusResponse(result: DeploymentStatusLookupResult): DeploymentStatusResponse {
  return {
    activeDeployments: result.activeDeployments.map(buildDeploymentReadSummary),
    deployments: result.deployments.map(buildDeploymentReadSummary),
    environment: buildDeploymentReadEnvironmentSummary(result.environment),
    project: buildDeploymentReadProjectSummary(result.project),
  };
}

export function buildDeploymentReadLogsResponse(result: DeploymentLogsLookupResult): DeploymentLogsResponse {
  return {
    deployments: result.deployments.map(buildDeploymentReadSummary),
    environment: buildDeploymentReadEnvironmentSummary(result.environment),
    lines: result.lines,
    project: buildDeploymentReadProjectSummary(result.project),
  };
}

export function buildDeploymentReadEnvironmentSummary(
  environment: DeploymentReadEnvironmentSummaryInput,
): DeploymentReadEnvironmentSummary {
  return {
    name: environment.name,
  };
}

export function buildDeploymentReadProjectSummary(
  project: DeploymentReadProjectSummaryInput,
): DeploymentReadProjectSummary {
  return {
    name: project.name,
  };
}

export function buildDeploymentReadSummary(parts: DeploymentSummaryInput): DeploymentReadSummary {
  return {
    ...buildDeploymentBaseSummary(parts),
    deploymentRunId: parts.deployment.deploymentRunId,
    operation: buildDeploymentReadOperationSummary(parts.operation),
  };
}

function buildDeploymentReadOperationSummary(operation: OperationSummaryInput): DeploymentReadOperationSummary {
  return {
    completedAt: toNullableIsoString(operation.completedAt),
    createdAt: operation.createdAt.toISOString(),
    status: operation.status,
    type: operation.type,
  };
}
