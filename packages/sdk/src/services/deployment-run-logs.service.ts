import {
  compartmentDeploymentRunLogsPathname,
  deploymentRunLogsResponseSchema,
  type DeploymentRunLogsQuery,
  type DeploymentRunLogsResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';
import { buildProjectDeploymentRunLogsPath } from './deployment-log-path.service';

export async function getDeploymentRunLogs(
  request: CompartmentRequester,
  query: DeploymentRunLogsQuery,
): Promise<DeploymentRunLogsResponse> {
  return await request<DeploymentRunLogsResponse, undefined>({
    method: 'GET',
    path: buildDeploymentRunLogsPath(query),
    schema: deploymentRunLogsResponseSchema,
  });
}

function buildDeploymentRunLogsPath(query: DeploymentRunLogsQuery): string {
  if (query.selector === 'latest') {
    return buildProjectDeploymentRunLogsPath({
      environmentName: query.environmentName,
      pathname: compartmentDeploymentRunLogsPathname,
      projectName: query.projectName,
      selector: 'latest',
      serviceName: query.serviceName,
      since: query.since,
      tailLines: query.tailLines,
    });
  }

  return buildProjectDeploymentRunLogsPath({
    deploymentRunId: query.deploymentRunId,
    environmentName: query.environmentName,
    pathname: compartmentDeploymentRunLogsPathname,
    projectName: query.projectName,
    selector: 'run',
    serviceName: query.serviceName,
    since: query.since,
    tailLines: query.tailLines,
  });
}
