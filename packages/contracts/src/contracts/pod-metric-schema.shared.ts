import { z } from 'zod';

interface PodMetricBaseSchemaShape {
  cpuMillicores: z.ZodNumber;
  memoryBytes: z.ZodNumber;
  namespace: z.ZodString;
  observedAt: z.ZodString;
  podName: z.ZodString;
  podUid: z.ZodString;
}

export const podMetricBaseShape: PodMetricBaseSchemaShape = {
  cpuMillicores: z.number().nonnegative().finite(),
  memoryBytes: z.number().int().nonnegative().safe(),
  namespace: z.string().min(1),
  observedAt: z.string().datetime(),
  podName: z.string().min(1),
  podUid: z.string().uuid(),
};
