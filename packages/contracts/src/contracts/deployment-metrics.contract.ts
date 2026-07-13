import { z } from 'zod';
import { compartmentServiceNameSchema } from './compartment-descriptor.contract';
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

interface PodMetricSampleSchemaShape {
  cpuMillicores: z.ZodNumber;
  deploymentId: z.ZodString;
  memoryBytes: z.ZodNumber;
  namespace: z.ZodString;
  observedAt: z.ZodString;
  podName: z.ZodString;
  podUid: z.ZodString;
}

const podMetricSampleShape: PodMetricSampleSchemaShape = {
  cpuMillicores: z.number().nonnegative().finite(),
  deploymentId: z.string().min(1),
  memoryBytes: z.number().int().nonnegative().safe(),
  namespace: z.string().min(1),
  observedAt: z.string().datetime(),
  podName: z.string().min(1),
  podUid: z.string().uuid(),
};

export const podMetricSampleSchema: ContractSchema<PodMetricSample> = z.object({ ...podMetricSampleShape }).strict();

const podResourceMetricSchema: ContractSchema<PodResourceMetric> = z
  .object({ ...podMetricSampleShape, serviceName: compartmentServiceNameSchema })
  .strict();

export const deploymentMetricsSnapshotSchema: ContractSchema<DeploymentMetricsSnapshot> = z
  .object({
    observedAt: z.string().datetime().nullable(),
    pods: z.array(podResourceMetricSchema),
    state: z.enum(['available', 'stale', 'unavailable']),
  })
  .strict();
