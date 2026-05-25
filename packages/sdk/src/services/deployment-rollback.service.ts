import {
  compartmentDeploymentsRollbackPathname,
  deployResponseSchema,
  type DeployResponse,
  type RollbackDeploymentRequest,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function rollbackDeployment(
  request: CompartmentRequester,
  body: RollbackDeploymentRequest,
): Promise<DeployResponse> {
  return await request<DeployResponse, RollbackDeploymentRequest>({
    body,
    method: 'POST',
    path: compartmentDeploymentsRollbackPathname,
    schema: deployResponseSchema,
  });
}
