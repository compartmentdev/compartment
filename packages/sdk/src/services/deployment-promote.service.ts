import {
  compartmentDeploymentsPromotePathname,
  deployResponseSchema,
  type DeployResponse,
  type PromoteDeploymentRequest,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function promoteDeployment(
  request: CompartmentRequester,
  body: PromoteDeploymentRequest,
): Promise<DeployResponse> {
  return await request<DeployResponse, PromoteDeploymentRequest>({
    body,
    method: 'POST',
    path: compartmentDeploymentsPromotePathname,
    schema: deployResponseSchema,
  });
}
