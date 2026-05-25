import {
  compartmentDeploymentLogsPathname,
  deploymentLogsResponseSchema,
  type DeploymentLogsQuery,
  type DeploymentLogsResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';
import { buildProjectDeploymentLogsPath } from './deployment-log-path.service';

export async function getDeploymentLogs(
  request: CompartmentRequester,
  query: DeploymentLogsQuery,
): Promise<DeploymentLogsResponse> {
  return await request<DeploymentLogsResponse, undefined>({
    method: 'GET',
    path: buildDeploymentLogsPath(query),
    schema: deploymentLogsResponseSchema,
  });
}

function buildDeploymentLogsPath(query: DeploymentLogsQuery): string {
  return buildProjectDeploymentLogsPath({
    environmentName: query.environmentName,
    pathname: compartmentDeploymentLogsPathname,
    projectName: query.projectName,
    serviceName: query.serviceName,
    since: query.since,
    tailLines: query.tailLines,
  });
}
