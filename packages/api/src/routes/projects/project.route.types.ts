import { z } from 'zod';
import { compartmentProjectNameSchema } from '@compartment/contracts';

export const projectRouteParamsSchema: z.ZodType<ProjectRouteParams> = z
  .object({
    projectName: compartmentProjectNameSchema,
  })
  .strict();

export interface ProjectRouteParams {
  projectName: string;
}
