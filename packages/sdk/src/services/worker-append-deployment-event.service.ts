import {
  workerAppendDeploymentEventPathname,
  workerAppendDeploymentEventRequestSchema,
  type WorkerAppendDeploymentEventRequest,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function appendDeploymentEvent(
  request: CompartmentRequester,
  body: WorkerAppendDeploymentEventRequest,
): Promise<WorkerAppendDeploymentEventRequest> {
  return await request<WorkerAppendDeploymentEventRequest, WorkerAppendDeploymentEventRequest>({
    body,
    method: 'POST',
    path: workerAppendDeploymentEventPathname,
    schema: workerAppendDeploymentEventRequestSchema,
  });
}
