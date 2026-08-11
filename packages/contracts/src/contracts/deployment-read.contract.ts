import { z } from 'zod';
import { operationStatusSchema, type OperationStatus } from './operations.contract';
import { compartmentProjectNameSchema, compartmentServiceNameSchema } from './compartment-descriptor.contract';
import {
  type DeploymentLogLine,
  type DeploymentPromotionStage,
  type DeploymentRuntimeHealth,
  type DeploymentReusableImageState,
  type DeploymentRuntimeStatus,
  deploymentLogLineSchema,
  deploymentPromotionStageSchema,
  deploymentRuntimeHealthSchema,
  deploymentRuntimeStatusSchema,
  deploymentReusableImageStateSchema,
  deploymentSummarySchema,
  environmentNameSchema,
} from './deployments.contract';
import { deploymentLogsQueryShape } from './deployment-logs-query-shape.contract';
import type { ContractSchema } from './schema.types';

export interface DeploymentReadEnvironmentSummary {
  name: string;
}

export interface DeploymentReadOperationSummary {
  completedAt: string | null;
  createdAt: string;
  status: OperationStatus;
  type: string;
}

export interface DeploymentReadProjectSummary {
  name: string;
}

export interface DeploymentReadSummary {
  accessProtected?: boolean | undefined;
  completedAt: string | null;
  createdAt: string;
  deploymentRunId: string;
  failureMessage: string | null;
  health: DeploymentRuntimeHealth;
  id: string;
  isActive: boolean;
  label: string | null;
  operation: DeploymentReadOperationSummary;
  promotionStage: DeploymentPromotionStage;
  reusableImageState?: DeploymentReusableImageState | undefined;
  rollbackAvailable: boolean;
  routeUrl: string | null;
  serviceName: string;
  status: DeploymentRuntimeStatus;
}

export interface DeploymentStatusQuery {
  deploymentId?: string | undefined;
  environmentName?: string | undefined;
  projectName: string;
  serviceName?: string | undefined;
}

export interface DeploymentInfrastructureBlocker {
  code: 'organization_quota_reconciliation_failed';
  message: string;
  retryAt: string;
}

export interface DeploymentStatusResponse {
  activeDeployments: DeploymentReadSummary[];
  deployments: DeploymentReadSummary[];
  environment: DeploymentReadEnvironmentSummary;
  infrastructureBlocker: DeploymentInfrastructureBlocker | null;
  project: DeploymentReadProjectSummary;
}

export interface DeploymentLogsQuery {
  environmentName?: string | undefined;
  projectName: string;
  serviceName?: string | undefined;
  since?: string | undefined;
  tailLines?: number | undefined;
}

export interface DeploymentLogsResponse {
  deployments: DeploymentReadSummary[];
  environment: DeploymentReadEnvironmentSummary;
  lines: DeploymentLogLine[];
  project: DeploymentReadProjectSummary;
}

export const deploymentReadEnvironmentSummarySchema: ContractSchema<DeploymentReadEnvironmentSummary> = z
  .object({
    name: environmentNameSchema,
  })
  .strict();

const deploymentReadOperationSummarySchema: ContractSchema<DeploymentReadOperationSummary> = z
  .object({
    completedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    status: operationStatusSchema,
    type: z.string().min(1),
  })
  .strict();

export const deploymentReadProjectSummarySchema: ContractSchema<DeploymentReadProjectSummary> = z
  .object({
    name: compartmentProjectNameSchema,
  })
  .strict();

type DeploymentReadSummaryObjectSchema = z.ZodObject<{
  accessProtected: z.ZodOptional<z.ZodBoolean>;
  completedAt: z.ZodNullable<z.ZodString>;
  createdAt: z.ZodString;
  deploymentRunId: z.ZodString;
  failureMessage: z.ZodNullable<z.ZodString>;
  health: typeof deploymentRuntimeHealthSchema;
  id: z.ZodString;
  isActive: z.ZodBoolean;
  label: typeof deploymentSummarySchema.shape.label;
  operation: typeof deploymentReadOperationSummarySchema;
  promotionStage: typeof deploymentPromotionStageSchema;
  reusableImageState: z.ZodOptional<typeof deploymentReusableImageStateSchema>;
  rollbackAvailable: z.ZodBoolean;
  routeUrl: z.ZodNullable<z.ZodString>;
  serviceName: typeof compartmentServiceNameSchema;
  status: typeof deploymentRuntimeStatusSchema;
}>;

export const deploymentReadSummarySchema: DeploymentReadSummaryObjectSchema = z
  .object({
    accessProtected: z.boolean().optional(),
    completedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    deploymentRunId: z.string().min(1),
    failureMessage: z.string().min(1).nullable(),
    health: deploymentRuntimeHealthSchema,
    id: z.string().min(1),
    isActive: z.boolean(),
    label: deploymentSummarySchema.shape.label,
    operation: deploymentReadOperationSummarySchema,
    promotionStage: deploymentPromotionStageSchema,
    reusableImageState: deploymentReusableImageStateSchema.optional(),
    rollbackAvailable: z.boolean(),
    routeUrl: z.string().url().nullable(),
    serviceName: compartmentServiceNameSchema,
    status: deploymentRuntimeStatusSchema,
  })
  .strict();

export const deploymentStatusQuerySchema: ContractSchema<DeploymentStatusQuery> = z
  .object({
    deploymentId: z.string().min(1).optional(),
    environmentName: environmentNameSchema.optional(),
    projectName: compartmentProjectNameSchema,
    serviceName: compartmentServiceNameSchema.optional(),
  })
  .strict();

export const deploymentStatusResponseSchema: ContractSchema<DeploymentStatusResponse> = z
  .object({
    activeDeployments: z.array(deploymentReadSummarySchema),
    deployments: z.array(deploymentReadSummarySchema),
    environment: deploymentReadEnvironmentSummarySchema,
    infrastructureBlocker: z
      .object({
        code: z.literal('organization_quota_reconciliation_failed'),
        message: z.string().min(1),
        retryAt: z.string().datetime(),
      })
      .strict()
      .nullable(),
    project: deploymentReadProjectSummarySchema,
  })
  .strict();

export const deploymentLogsQuerySchema: ContractSchema<DeploymentLogsQuery> = z
  .object({ ...deploymentLogsQueryShape })
  .strict();

export const deploymentLogsResponseSchema: ContractSchema<DeploymentLogsResponse> = z
  .object({
    deployments: z.array(deploymentReadSummarySchema),
    environment: deploymentReadEnvironmentSummarySchema,
    project: deploymentReadProjectSummarySchema,
    lines: z.array(deploymentLogLineSchema),
  })
  .strict();
