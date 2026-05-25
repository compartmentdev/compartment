import {
  type WorkerRecoverDeploymentsQuery,
  type WorkerRecoverDeploymentsResponse,
  workerRecoverDeploymentsPathname,
  workerRecoverDeploymentsResponseSchema,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';
import { buildListPath } from './list-path.service';

export async function recoverRunningDeployments(
  request: CompartmentRequester,
  query: WorkerRecoverDeploymentsQuery = {},
): Promise<WorkerRecoverDeploymentsResponse> {
  return await request<WorkerRecoverDeploymentsResponse, undefined>({
    method: 'POST',
    path: buildRecoverRunningDeploymentsPath(query),
    schema: workerRecoverDeploymentsResponseSchema,
  });
}

function buildRecoverRunningDeploymentsPath(query: WorkerRecoverDeploymentsQuery): string {
  return buildListPath(workerRecoverDeploymentsPathname, [{ name: 'mode', value: query.mode }]);
}
