import { z } from 'zod';
import { compartmentServiceNameSchema } from './compartment-descriptor.contract';
import { podMetricBaseShape } from './pod-metric-schema.shared';
import type { ContractSchema } from './schema.types';

export interface PodMetricSample {
  cpuMillicores: number;
  deploymentId: string;
  memoryBytes: number;
  namespace: string;
  observedAt: string;
  podName: string;
  podUid: string;
}

export interface PodResourceMetric extends PodMetricSample {
  serviceName: string;
}

export interface DeploymentMetricsSnapshot {
  observedAt: string | null;
  pods: PodResourceMetric[];
  state: 'available' | 'stale' | 'unavailable';
}

const podResourceMetricSchema: ContractSchema<PodResourceMetric> = z
  .object({ ...podMetricBaseShape, deploymentId: z.string().min(1), serviceName: compartmentServiceNameSchema })
  .strict();

export const deploymentMetricsSnapshotSchema: ContractSchema<DeploymentMetricsSnapshot> = z
  .object({
    observedAt: z.string().datetime().nullable(),
    pods: z.array(podResourceMetricSchema),
    state: z.enum(['available', 'stale', 'unavailable']),
  })
  .strict();
