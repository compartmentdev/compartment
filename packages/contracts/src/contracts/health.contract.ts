import { z } from 'zod';
import type { ContractSchema } from './schema.types';

export interface HealthResponse {
  service: string;
  status: 'ok';
  timestamp: string;
}

export const healthResponseSchema: ContractSchema<HealthResponse> = z
  .object({
    status: z.literal('ok'),
    service: z.string().min(1),
    timestamp: z.string().datetime(),
  })
  .strict();
