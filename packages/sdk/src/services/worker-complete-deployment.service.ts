import {
  type WorkerCompleteDeploymentRequest,
  type WorkerCompleteDeploymentResponse,
  workerCompleteDeploymentPathname,
  workerCompleteDeploymentResponseSchema,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function completeDeployment(
  request: CompartmentRequester,
  body: WorkerCompleteDeploymentRequest,
): Promise<WorkerCompleteDeploymentResponse> {
  return await request<WorkerCompleteDeploymentResponse, WorkerCompleteDeploymentRequest>({
    body,
    method: 'POST',
    path: workerCompleteDeploymentPathname,
    schema: workerCompleteDeploymentResponseSchema,
  });
}
