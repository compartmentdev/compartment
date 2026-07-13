import {
  workerPublishPodMetricsPathname,
  workerPublishPodMetricsRequestSchema,
  type WorkerPublishPodMetricsRequest,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function publishPodMetrics(
  request: CompartmentRequester,
  body: WorkerPublishPodMetricsRequest,
): Promise<WorkerPublishPodMetricsRequest> {
  return await request<WorkerPublishPodMetricsRequest, WorkerPublishPodMetricsRequest>({
    body,
    method: 'POST',
    path: workerPublishPodMetricsPathname,
    schema: workerPublishPodMetricsRequestSchema,
  });
}
