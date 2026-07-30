import { z } from 'zod';
import { podMetricBaseShape } from './pod-metric-schema.shared';
import type { ContractSchema } from './schema.types';

export const workerPublishPodMetricsPathname: string = '/internal/kubernetes/pod-metrics';
export const workerListPodMetricNamespacesPathname: string = '/internal/kubernetes/pod-metric-namespaces';
export const edgePublishTrafficMetricsPathname: string = '/internal/edge/traffic-metrics';

export interface EdgeTrafficMetric {
  observedAt: string;
  requestBytes: number;
  requestCount: number;
  responseBytes: number;
  status4xxCount: number;
  status5xxCount: number;
  upstreamHost: string;
}

export interface EdgePublishTrafficMetricsRequest {
  batchId: string;
  metrics: EdgeTrafficMetric[];
  sourceId: string;
}

export interface EdgePublishTrafficMetricsResponse {
  status: 'accepted' | 'duplicate';
}

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

const trafficCounterSchema: z.ZodNumber = z.number().int().nonnegative().safe();

const edgeTrafficMetricSchema: ContractSchema<EdgeTrafficMetric> = z
  .object({
    observedAt: z.string().datetime(),
    requestBytes: trafficCounterSchema,
    requestCount: trafficCounterSchema,
    responseBytes: trafficCounterSchema,
    status4xxCount: trafficCounterSchema,
    status5xxCount: trafficCounterSchema,
    upstreamHost: z.string().min(1),
  })
  .strict();

export const edgePublishTrafficMetricsRequestSchema: ContractSchema<EdgePublishTrafficMetricsRequest> = z
  .object({
    batchId: z.string().min(1).max(200),
    metrics: z.array(edgeTrafficMetricSchema).min(1).max(10_000),
    sourceId: z.string().min(1).max(100),
  })
  .strict();

export const edgePublishTrafficMetricsResponseSchema: ContractSchema<EdgePublishTrafficMetricsResponse> = z
  .object({ status: z.enum(['accepted', 'duplicate']) })
  .strict();
