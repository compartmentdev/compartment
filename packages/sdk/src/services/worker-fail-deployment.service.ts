import {
  type WorkerFailDeploymentRequest,
  workerFailDeploymentPathname,
  workerFailDeploymentRequestSchema,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function failDeployment(
  request: CompartmentRequester,
  body: WorkerFailDeploymentRequest,
): Promise<WorkerFailDeploymentRequest> {
  return await request<WorkerFailDeploymentRequest, WorkerFailDeploymentRequest>({
    body,
    method: 'POST',
    path: workerFailDeploymentPathname,
    schema: workerFailDeploymentRequestSchema,
  });
}
