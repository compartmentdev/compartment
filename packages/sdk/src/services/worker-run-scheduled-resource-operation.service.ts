import {
  workerRunNextScheduledResourceOperationPathname,
  workerRunNextScheduledResourceOperationResponseSchema,
  type WorkerRunNextScheduledResourceOperationResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function runNextScheduledResourceOperation(
  request: CompartmentRequester,
): Promise<WorkerRunNextScheduledResourceOperationResponse> {
  return await request<WorkerRunNextScheduledResourceOperationResponse, undefined>({
    method: 'POST',
    path: workerRunNextScheduledResourceOperationPathname,
    schema: workerRunNextScheduledResourceOperationResponseSchema,
  });
}
