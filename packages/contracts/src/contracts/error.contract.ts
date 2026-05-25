import { z } from 'zod';
import type { ContractSchema } from './schema.types';

export interface ErrorDetails {
  code: string;
  message: string;
}

export interface ErrorResponse {
  error: ErrorDetails;
}

export const errorResponseSchema: ContractSchema<ErrorResponse> = z
  .object({
    error: z
      .object({
        code: z.string().min(1),
        message: z.string().min(1),
      })
      .strict(),
  })
  .strict();
