import {
  compartmentDeploymentsStatusPathname,
  deploymentStatusResponseSchema,
  type DeploymentStatusQuery,
  type DeploymentStatusResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';
import { buildListPath } from './list-path.service';

export async function getDeploymentStatus(
  request: CompartmentRequester,
  query: DeploymentStatusQuery,
): Promise<DeploymentStatusResponse> {
  return await request<DeploymentStatusResponse, undefined>({
    method: 'GET',
    path: buildDeploymentStatusPath(query),
    schema: deploymentStatusResponseSchema,
  });
}

function buildDeploymentStatusPath(query: DeploymentStatusQuery): string {
  return buildListPath(compartmentDeploymentsStatusPathname, [
    { name: 'projectName', value: query.projectName },
    { name: 'environmentName', value: query.environmentName },
    { name: 'deploymentId', value: query.deploymentId },
    { name: 'serviceName', value: query.serviceName },
  ]);
}
