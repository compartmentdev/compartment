import {
  workerClaimDeploymentResponseSchema,
  workerClaimNextDeploymentPathname,
  type WorkerClaimDeploymentResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function claimNextDeployment(request: CompartmentRequester): Promise<WorkerClaimDeploymentResponse> {
  return await request<WorkerClaimDeploymentResponse, undefined>({
    method: 'POST',
    path: workerClaimNextDeploymentPathname,
    schema: workerClaimDeploymentResponseSchema,
  });
}
