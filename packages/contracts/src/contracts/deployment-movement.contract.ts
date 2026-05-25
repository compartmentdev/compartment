import { z } from 'zod';
import {
  type DeploymentReadEnvironmentSummary,
  type DeploymentReadProjectSummary,
  type DeploymentReadSummary,
  deploymentReadEnvironmentSummarySchema,
  deploymentReadProjectSummarySchema,
  deploymentReadSummarySchema,
} from './deployment-read.contract';
import { compartmentProjectNameSchema, compartmentServiceNameSchema } from './compartment-descriptor.contract';
import { environmentNameSchema } from './environments.contract';
import type { ContractSchema } from './schema.types';

export const deploymentListLimit: number = 100;

export interface PromoteDeploymentRequest {
  projectName: string;
  serviceName?: string | undefined;
  sourceEnvironmentName: string;
  targetEnvironmentName: string;
}

export interface RollbackDeploymentRequest {
  environmentName: string;
  projectName: string;
  serviceName?: string | undefined;
  targetDeploymentId?: string | undefined;
  targetDeploymentRunId?: string | undefined;
}

export interface DeploymentListQuery {
  environmentName?: string | undefined;
  limit?: number | undefined;
  projectName: string;
  serviceName?: string | undefined;
}

export interface DeploymentListResponse {
  deployments: DeploymentReadSummary[];
  environment: DeploymentReadEnvironmentSummary;
  project: DeploymentReadProjectSummary;
}

type DeploymentListLimitInputValue = number | string | undefined;

interface DeploymentListQueryInput {
  environmentName?: string | undefined;
  limit?: DeploymentListLimitInputValue;
  projectName: string;
  serviceName?: string | undefined;
}

const deploymentListLimitSchema: z.ZodType<number, z.ZodTypeDef, DeploymentListLimitInputValue> = z.coerce
  .number()
  .int()
  .positive()
  .max(deploymentListLimit);

export const promoteDeploymentRequestSchema: ContractSchema<PromoteDeploymentRequest> = z
  .object({
    projectName: compartmentProjectNameSchema,
    serviceName: compartmentServiceNameSchema.optional(),
    sourceEnvironmentName: environmentNameSchema,
    targetEnvironmentName: environmentNameSchema,
  })
  .strict();

export const rollbackDeploymentRequestSchema: ContractSchema<RollbackDeploymentRequest> = z
  .object({
    environmentName: environmentNameSchema,
    projectName: compartmentProjectNameSchema,
    serviceName: compartmentServiceNameSchema.optional(),
    targetDeploymentId: z.string().min(1).optional(),
    targetDeploymentRunId: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value: RollbackDeploymentRequest, context: z.RefinementCtx): void => {
    if (value.targetDeploymentId !== undefined && value.targetDeploymentRunId !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide either targetDeploymentId or targetDeploymentRunId, not both.',
        path: ['targetDeploymentRunId'],
      });
    }
    if (value.targetDeploymentRunId !== undefined && value.serviceName !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'serviceName is not supported when rolling back to a deployment run.',
        path: ['serviceName'],
      });
    }
  });

export const deploymentListQuerySchema: z.ZodType<DeploymentListQuery, z.ZodTypeDef, DeploymentListQueryInput> = z
  .object({
    environmentName: environmentNameSchema.optional(),
    limit: deploymentListLimitSchema.optional(),
    projectName: compartmentProjectNameSchema,
    serviceName: compartmentServiceNameSchema.optional(),
  })
  .strict();

export const deploymentListResponseSchema: ContractSchema<DeploymentListResponse> = z
  .object({
    deployments: z.array(deploymentReadSummarySchema),
    environment: deploymentReadEnvironmentSummarySchema,
    project: deploymentReadProjectSummarySchema,
  })
  .strict();
