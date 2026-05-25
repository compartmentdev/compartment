import {
  compartmentDeploymentsPathname,
  deploymentListResponseSchema,
  type DeploymentListQuery,
  type DeploymentListResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';
import { buildListPath } from './list-path.service';

export async function listDeployments(
  request: CompartmentRequester,
  query: DeploymentListQuery,
): Promise<DeploymentListResponse> {
  return await request<DeploymentListResponse, undefined>({
    method: 'GET',
    path: buildDeploymentListPath(query),
    schema: deploymentListResponseSchema,
  });
}

function buildDeploymentListPath(query: DeploymentListQuery): string {
  return buildListPath(compartmentDeploymentsPathname, [
    { name: 'environmentName', value: query.environmentName },
    { name: 'limit', value: query.limit },
    { name: 'projectName', value: query.projectName },
    { name: 'serviceName', value: query.serviceName },
  ]);
}
