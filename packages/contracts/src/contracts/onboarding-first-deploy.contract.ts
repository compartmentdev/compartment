import { z } from 'zod';
import type { ContractSchema } from './schema.types';

export type FirstDeployOnboardingMethod = 'cli';
export type FirstDeployOnboardingSessionState = 'active' | 'skipped';
export type FirstDeployOnboardingStatusKey =
  | 'cli_login_authenticated'
  | 'cli_login_pending'
  | 'deploy_failed'
  | 'deploy_pending'
  | 'deploy_succeeded'
  | 'type_required';

export interface FirstDeployOnboardingSession {
  createdAt: string;
  id: string;
  method: FirstDeployOnboardingMethod | null;
  organizationSlug: string;
  skippedAt: string | null;
  state: FirstDeployOnboardingSessionState;
  updatedAt: string;
}

export interface CreateFirstDeployOnboardingSessionRequest {
  method?: FirstDeployOnboardingMethod | undefined;
}

export interface FirstDeployOnboardingSessionResponse {
  session: FirstDeployOnboardingSession;
}

export interface PatchFirstDeployOnboardingSessionRequest {
  method?: FirstDeployOnboardingMethod | undefined;
  skipped?: boolean | undefined;
}

export interface FirstDeployOnboardingStatusResponse {
  session: FirstDeployOnboardingSession;
  status: FirstDeployOnboardingStatusKey;
  statusText: string;
}

const firstDeployOnboardingMethodSchema: ContractSchema<FirstDeployOnboardingMethod> = z.literal('cli');
const firstDeployOnboardingSessionStateSchema: ContractSchema<FirstDeployOnboardingSessionState> = z.enum([
  'active',
  'skipped',
]);
const firstDeployOnboardingStatusKeySchema: ContractSchema<FirstDeployOnboardingStatusKey> = z.enum([
  'cli_login_authenticated',
  'cli_login_pending',
  'deploy_failed',
  'deploy_pending',
  'deploy_succeeded',
  'type_required',
]);

export const createFirstDeployOnboardingSessionRequestSchema: ContractSchema<CreateFirstDeployOnboardingSessionRequest> =
  z
    .object({
      method: firstDeployOnboardingMethodSchema.optional(),
    })
    .strict();

const firstDeployOnboardingSessionSchema: ContractSchema<FirstDeployOnboardingSession> = z
  .object({
    createdAt: z.string().datetime(),
    id: z.string().min(1),
    method: firstDeployOnboardingMethodSchema.nullable(),
    organizationSlug: z.string().min(1),
    skippedAt: z.string().datetime().nullable(),
    state: firstDeployOnboardingSessionStateSchema,
    updatedAt: z.string().datetime(),
  })
  .strict();

export const firstDeployOnboardingSessionResponseSchema: ContractSchema<FirstDeployOnboardingSessionResponse> = z
  .object({
    session: firstDeployOnboardingSessionSchema,
  })
  .strict();

export const patchFirstDeployOnboardingSessionRequestSchema: ContractSchema<PatchFirstDeployOnboardingSessionRequest> =
  z
    .object({
      method: firstDeployOnboardingMethodSchema.optional(),
      skipped: z.boolean().optional(),
    })
    .strict();

export const firstDeployOnboardingStatusResponseSchema: ContractSchema<FirstDeployOnboardingStatusResponse> = z
  .object({
    session: firstDeployOnboardingSessionSchema,
    status: firstDeployOnboardingStatusKeySchema,
    statusText: z.string().min(1),
  })
  .strict();
