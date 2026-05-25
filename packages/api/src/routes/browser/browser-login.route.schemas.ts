import { z } from 'zod';

interface BrowserCliQuery {
  attempt: string;
}

export const browserCliQuerySchema: z.ZodType<BrowserCliQuery> = z
  .object({
    attempt: z.string().min(1),
  })
  .strict();

export interface BrowserCliStartBody {
  attempt: string;
  code: string;
}

export const browserCliStartBodySchema: z.ZodType<BrowserCliStartBody> = z
  .object({
    attempt: z.string().min(1),
    code: z.string().min(1),
  })
  .strict();

interface BrowserCliStartResponse {
  loginUrl: string;
}

export const browserCliStartResponseSchema: z.ZodType<BrowserCliStartResponse> = z
  .object({
    loginUrl: z.string().min(1),
  })
  .strict();

export interface BrowserCliCompletedQuery {
  status?: 'failed' | undefined;
}

export const browserCliCompletedQuerySchema: z.ZodType<BrowserCliCompletedQuery> = z
  .object({
    status: z.enum(['failed']).optional(),
  })
  .strict();
