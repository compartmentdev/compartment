import {
  workerClaimDeploymentRequestSchema,
  workerClaimDeploymentResponseSchema,
  workerClaimNextDeploymentPathname,
  type WorkerClaimDeploymentRequest,
  type WorkerClaimDeploymentResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function claimNextDeployment(
  request: CompartmentRequester,
  body: WorkerClaimDeploymentRequest,
): Promise<WorkerClaimDeploymentResponse> {
  return await request<WorkerClaimDeploymentResponse, WorkerClaimDeploymentRequest>({
    body: workerClaimDeploymentRequestSchema.parse(body),
    method: 'POST',
    path: workerClaimNextDeploymentPathname,
    schema: workerClaimDeploymentResponseSchema,
  });
}
