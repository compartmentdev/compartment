import { z } from 'zod';
import type { ContractSchema } from './schema.types';

export type OperationStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface OperationSummary {
  completedAt: string | null;
  createdAt: string;
  id: string;
  status: OperationStatus;
  targetId: string;
  targetType: string;
  type: string;
}

export const operationStatusSchema: ContractSchema<OperationStatus> = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
]);

export const operationSummarySchema: ContractSchema<OperationSummary> = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    status: operationStatusSchema,
    targetType: z.string().min(1),
    targetId: z.string().min(1),
    createdAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
  })
  .strict();
