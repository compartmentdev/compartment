import { z, type ZodType } from 'zod';

export interface FirstDeployOnboardingSessionRouteParams {
  sessionId: string;
}

export const firstDeployOnboardingSessionRouteParamsSchema: ZodType<FirstDeployOnboardingSessionRouteParams> = z
  .object({
    sessionId: z.string().min(1),
  })
  .strict();
