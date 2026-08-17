import type { KubeDataWorkloadScheduling, KubeToleration, KubeWorkloadScheduling } from '@compartment/kube-runtime';
import { z } from 'zod';
import type { WorkerBuildScheduling } from './config.types';

const tolerationSchema: z.ZodType<KubeToleration> = z.object({
  effect: z.enum(['NoExecute', 'NoSchedule', 'PreferNoSchedule']).optional(),
  key: z.string().optional(),
  operator: z.enum(['Equal', 'Exists']).optional(),
  tolerationSeconds: z.number().int().nonnegative().optional(),
  value: z.string().optional(),
});

const tenantWorkloadSchedulingSchema: z.ZodType<KubeWorkloadScheduling> = z.object({
  nodeSelector: z.record(z.string(), z.string()),
  runtimeClassName: z.string().min(1).optional(),
  tolerations: z.array(tolerationSchema),
});

export function readTenantWorkloadScheduling(value: string | undefined): KubeWorkloadScheduling | undefined {
  if (value === undefined) {
    return undefined;
  }
  return tenantWorkloadSchedulingSchema.parse(JSON.parse(value));
}

export function readBuildWorkloadScheduling(value: string): WorkerBuildScheduling {
  const scheduling: KubeWorkloadScheduling = tenantWorkloadSchedulingSchema.parse(JSON.parse(value));
  if (scheduling.runtimeClassName === undefined) {
    throw new Error('Build scheduling must configure a gVisor RuntimeClass.');
  }
  return { ...scheduling, runtimeClassName: scheduling.runtimeClassName };
}

export function readDataWorkloadScheduling(value: string): KubeDataWorkloadScheduling {
  const scheduling: KubeWorkloadScheduling = tenantWorkloadSchedulingSchema.parse(JSON.parse(value));
  if (Object.keys(scheduling.nodeSelector).length === 0) {
    throw new Error('Data scheduling must select dedicated data workers.');
  }
  if (scheduling.runtimeClassName === undefined) {
    throw new Error('Data scheduling must configure a gVisor RuntimeClass.');
  }
  return { ...scheduling, runtimeClassName: scheduling.runtimeClassName };
}
