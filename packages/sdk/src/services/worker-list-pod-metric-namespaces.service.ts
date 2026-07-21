import {
  workerListPodMetricNamespacesPathname,
  workerListPodMetricNamespacesResponseSchema,
  type WorkerListPodMetricNamespacesResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function listPodMetricNamespaces(
  request: CompartmentRequester,
): Promise<WorkerListPodMetricNamespacesResponse> {
  return await request<WorkerListPodMetricNamespacesResponse, never>({
    method: 'GET',
    path: workerListPodMetricNamespacesPathname,
    schema: workerListPodMetricNamespacesResponseSchema,
  });
}
