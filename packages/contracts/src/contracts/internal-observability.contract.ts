import { z } from 'zod';
import type { ContractSchema } from './schema.types';
import { podMetricSampleSchema, type PodMetricSample } from './deployment-metrics.contract';

export const workerPublishPodMetricsPathname: string = '/internal/kubernetes/pod-metrics';

export type WorkerPodResourceMetric = PodMetricSample;

export interface WorkerPublishPodMetricsRequest {
  observedAt: string;
  pods: WorkerPodResourceMetric[];
  state: 'available' | 'unavailable';
}

const workerPodResourceMetricSchema: ContractSchema<WorkerPodResourceMetric> = podMetricSampleSchema;

export const workerPublishPodMetricsRequestSchema: ContractSchema<WorkerPublishPodMetricsRequest> = z
  .object({
    observedAt: z.string().datetime(),
    pods: z.array(workerPodResourceMetricSchema).max(10_000),
    state: z.enum(['available', 'unavailable']),
  })
  .strict();
