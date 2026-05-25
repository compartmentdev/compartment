import { z } from 'zod';

export interface CustomDomainRouteParams {
  host: string;
}

export const customDomainRouteParamsSchema: z.ZodType<CustomDomainRouteParams> = z
  .object({
    host: z.string().min(1),
  })
  .strict();
