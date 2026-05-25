import {
  workerUpdateDeploymentRuntimePathname,
  workerUpdateDeploymentRuntimeRequestSchema,
  type WorkerUpdateDeploymentRuntimeRequest,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function updateDeploymentRuntime(
  request: CompartmentRequester,
  body: WorkerUpdateDeploymentRuntimeRequest,
): Promise<WorkerUpdateDeploymentRuntimeRequest> {
  return await request<WorkerUpdateDeploymentRuntimeRequest, WorkerUpdateDeploymentRuntimeRequest>({
    body,
    method: 'POST',
    path: workerUpdateDeploymentRuntimePathname,
    schema: workerUpdateDeploymentRuntimeRequestSchema,
  });
}
