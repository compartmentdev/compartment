import { z } from 'zod';
import { deploymentSummarySchema, type DeploymentSummary } from './deployments.contract';
import { environmentNameSchema, environmentSummarySchema, type EnvironmentSummary } from './environments.contract';
import { projectSummarySchema, type ProjectSummary } from './projects.contract';
import type { ContractSchema } from './schema.types';

export type ProjectLifecycleAction = 'start' | 'stop';
export type ProjectLifecycleState = 'needs_attention' | 'not_deployed' | 'running' | 'stopped' | 'updating';

export interface ProjectLifecycleRequest {
  environmentName?: string | undefined;
}

export interface ProjectLifecycleResponse {
  action: ProjectLifecycleAction;
  deployments: DeploymentSummary[];
  environment: EnvironmentSummary;
  project: ProjectSummary;
  state: ProjectLifecycleState;
}

type ProjectLifecycleRequestInput = ProjectLifecycleRequest | undefined;

const projectLifecycleActionSchema: ContractSchema<ProjectLifecycleAction> = z.enum(['start', 'stop']);

const projectLifecycleStateSchema: ContractSchema<ProjectLifecycleState> = z.enum([
  'needs_attention',
  'not_deployed',
  'running',
  'stopped',
  'updating',
]);

export const projectLifecycleRequestSchema: z.ZodType<
  ProjectLifecycleRequest,
  z.ZodTypeDef,
  ProjectLifecycleRequestInput
> = z
  .object({
    environmentName: environmentNameSchema.optional(),
  })
  .strict()
  .optional()
  .transform((value: ProjectLifecycleRequest | undefined): ProjectLifecycleRequest => value ?? {});

export const projectLifecycleResponseSchema: ContractSchema<ProjectLifecycleResponse> = z
  .object({
    action: projectLifecycleActionSchema,
    state: projectLifecycleStateSchema,
    project: projectSummarySchema,
    environment: environmentSummarySchema,
    deployments: z.array(deploymentSummarySchema),
  })
  .strict();
