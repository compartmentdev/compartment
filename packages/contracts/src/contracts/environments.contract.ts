import { z } from 'zod';
import type { ContractSchema } from './schema.types';

export interface EnvironmentSummary {
  createdAt: string;
  id: string;
  name: string;
  projectId: string;
  updatedAt: string;
}

export const environmentNameSchema: ContractSchema<string> = z.string().min(1).max(63);

export const environmentSummarySchema: ContractSchema<EnvironmentSummary> = z
  .object({
    createdAt: z.string().datetime(),
    id: z.string().min(1),
    name: environmentNameSchema,
    projectId: z.string().min(1),
    updatedAt: z.string().datetime(),
  })
  .strict();
