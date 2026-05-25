import {
  compartmentDeploymentsInspectPathname,
  deploymentInspectResponseSchema,
  type DeploymentInspectQuery,
  type DeploymentInspectResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';
import { buildListPath } from './list-path.service';

export async function getDeploymentInspect(
  request: CompartmentRequester,
  query: DeploymentInspectQuery,
): Promise<DeploymentInspectResponse> {
  return await request<DeploymentInspectResponse, undefined>({
    method: 'GET',
    path: buildDeploymentInspectPath(query),
    schema: deploymentInspectResponseSchema,
  });
}

function buildDeploymentInspectPath(query: DeploymentInspectQuery): string {
  return buildListPath(compartmentDeploymentsInspectPathname, [
    { name: 'projectName', value: query.projectName },
    { name: 'environmentName', value: query.environmentName },
    { name: 'deploymentId', value: query.deploymentId },
    { name: 'serviceName', value: query.serviceName },
  ]);
}
