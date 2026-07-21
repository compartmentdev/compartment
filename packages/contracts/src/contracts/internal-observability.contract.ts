import { z } from 'zod';
import type { ContractSchema } from './schema.types';
import { podMetricSampleSchema, type PodMetricSample } from './deployment-metrics.contract';

export const workerPublishPodMetricsPathname: string = '/internal/kubernetes/pod-metrics';
export const workerListPodMetricNamespacesPathname: string = '/internal/kubernetes/pod-metric-namespaces';

export type WorkerPodResourceMetric = PodMetricSample;

export interface WorkerPublishPodMetricsRequest {
  observedAt: string;
  pods: WorkerPodResourceMetric[];
  state: 'available' | 'unavailable';
}

export interface WorkerListPodMetricNamespacesResponse {
  namespaceIds: string[];
}

const workerPodResourceMetricSchema: ContractSchema<WorkerPodResourceMetric> = podMetricSampleSchema;

export const workerPublishPodMetricsRequestSchema: ContractSchema<WorkerPublishPodMetricsRequest> = z
  .object({
    observedAt: z.string().datetime(),
    pods: z.array(workerPodResourceMetricSchema).max(10_000),
    state: z.enum(['available', 'unavailable']),
  })
  .strict();

export const workerListPodMetricNamespacesResponseSchema: ContractSchema<WorkerListPodMetricNamespacesResponse> = z
  .object({ namespaceIds: z.array(z.string().min(1)).max(10_000) })
  .strict();
