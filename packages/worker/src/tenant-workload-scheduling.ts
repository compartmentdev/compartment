import type { KubeToleration, KubeWorkloadScheduling } from '@compartment/kube-runtime';
import { z } from 'zod';

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
