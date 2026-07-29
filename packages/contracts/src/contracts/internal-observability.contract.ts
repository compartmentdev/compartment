import { z } from 'zod';
import { podMetricBaseShape } from './pod-metric-schema.shared';
import type { ContractSchema } from './schema.types';

export const workerPublishPodMetricsPathname: string = '/internal/kubernetes/pod-metrics';
export const workerListPodMetricNamespacesPathname: string = '/internal/kubernetes/pod-metric-namespaces';

interface WorkerPodMetricBase {
  cpuMillicores: number;
  memoryBytes: number;
  namespace: string;
  observedAt: string;
  podName: string;
  podUid: string;
}

export interface WorkerApplicationPodMetric extends WorkerPodMetricBase {
  deploymentId: string;
  kind: 'application';
}

export interface WorkerResourcePodMetric extends WorkerPodMetricBase {
  kind: 'resource';
  resourceId: string;
}

export type WorkerPodResourceMetric = WorkerApplicationPodMetric | WorkerResourcePodMetric;

export interface WorkerPublishPodMetricsRequest {
  observedAt: string;
  pods: WorkerPodResourceMetric[];
  state: 'available' | 'unavailable';
}

export interface WorkerListPodMetricNamespacesResponse {
  namespaceIds: string[];
}

const workerPodResourceMetricSchema: ContractSchema<WorkerPodResourceMetric> = z.discriminatedUnion('kind', [
  z.object({ ...podMetricBaseShape, deploymentId: z.string().min(1), kind: z.literal('application') }).strict(),
  z.object({ ...podMetricBaseShape, kind: z.literal('resource'), resourceId: z.string().min(1) }).strict(),
]);

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
