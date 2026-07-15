import { z } from 'zod';
import { type OperationSummary, operationSummarySchema } from './operations.contract';
import {
  type CompartmentAuthoredDescriptor,
  type CompartmentAuthoredDescriptorInput,
  compartmentAuthoredDescriptorSchema,
  compartmentServiceNameSchema,
} from './compartment-descriptor.contract';
import { type CompartmentRoutesFile, compartmentRoutesFileSchema } from './compartment-routes.contract';
import { environmentNameSchema, environmentSummarySchema, type EnvironmentSummary } from './environments.contract';
import { type ProjectSummary, projectSummarySchema } from './projects.contract';
import {
  resolvedOptionalServiceReadinessConfigSchema,
  type ResolvedOptionalServiceReadinessConfig,
} from './service-readiness.contract';
import {
  resolvedCompartmentServiceBuildConfigSchema,
  type ResolvedCompartmentServiceBuildConfig,
} from './service-build.contract';
import {
  resolvedCompartmentServiceRunConfigSchema,
  type ResolvedCompartmentServiceRunConfig,
} from './service-run.contract';
import { resourceSummarySchema, type ResourceSummary } from './resources.contract';
import { sourceUploadIdSchema } from './source-uploads.contract';
import type { ContractSchema } from './schema.types';

export { environmentNameSchema };
export type { EnvironmentSummary };

export type DeploymentRuntimeHealth = 'pending' | 'healthy' | 'unhealthy';
export type DeploymentPromotionStage = 'active' | 'building' | 'release' | 'rolled_back' | 'stopped';
export type DeploymentReusableImageState = 'available' | 'cleaned' | 'missing';
export type DeploymentRuntimeStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'stopped';
export type DeploymentLogStream = 'compartment' | 'stdout' | 'stderr';
export const defaultCompartmentEnvironmentName: string = 'production';
const deploymentLabelMaxLength: number = 100;
const deploymentLabelValidationMessage: string = 'Label must use printable single-line text.';
const deploymentLabelDisallowedPattern: RegExp = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

interface DeploymentRollbackAvailabilityInput {
  isActive: boolean;
  reusableImageState: DeploymentReusableImageState;
  status: DeploymentRuntimeStatus;
}

export interface DeploymentSummary {
  build: ResolvedCompartmentServiceBuildConfig;
  completedAt: string | null;
  createdAt: string;
  failureMessage: string | null;
  health: DeploymentRuntimeHealth;
  id: string;
  isActive: boolean;
  label: string | null;
  operation: OperationSummary;
  promotionStage: DeploymentPromotionStage;
  readiness: ResolvedOptionalServiceReadinessConfig;
  reusableImageState?: DeploymentReusableImageState | undefined;
  rollbackAvailable: boolean;
  run: ResolvedCompartmentServiceRunConfig;
  routeUrl: string | null;
  serviceName: string;
  status: DeploymentRuntimeStatus;
}

export interface DeploymentLogLine {
  deploymentId: string;
  environmentName: string;
  message: string;
  serviceName: string;
  stream: DeploymentLogStream;
  timestamp: string;
}

export interface DeployRequest {
  descriptor: CompartmentAuthoredDescriptor;
  environmentName?: string | undefined;
  label?: string | undefined;
  onboardingSessionId?: string | undefined;
  routes?: CompartmentRoutesFile | undefined;
  serviceName?: string | undefined;
  sourceUploadId: string;
}

export interface DeployRequestInput {
  descriptor: CompartmentAuthoredDescriptorInput;
  environmentName?: string | undefined;
  label?: string | undefined;
  onboardingSessionId?: string | undefined;
  routes?: CompartmentRoutesFile | undefined;
  serviceName?: string | undefined;
  sourceUploadId: string;
}

export interface DeployResponse {
  deploymentRunId: string;
  deployments: DeploymentSummary[];
  environment: EnvironmentSummary;
  project: ProjectSummary;
  resources: ResourceSummary[];
}

export function resolveCompartmentEnvironmentName(environmentName: string | undefined): string {
  return environmentName ?? defaultCompartmentEnvironmentName;
}

export function isDeploymentRollbackAvailable(input: DeploymentRollbackAvailabilityInput): boolean {
  return input.status === 'succeeded' && input.isActive === false && input.reusableImageState === 'available';
}

export const deploymentRuntimeHealthSchema: ContractSchema<DeploymentRuntimeHealth> = z.enum([
  'pending',
  'healthy',
  'unhealthy',
]);

export const deploymentPromotionStageSchema: ContractSchema<DeploymentPromotionStage> = z.enum([
  'active',
  'building',
  'release',
  'rolled_back',
  'stopped',
]);

export const deploymentRuntimeStatusSchema: ContractSchema<DeploymentRuntimeStatus> = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'stopped',
]);
export const deploymentReusableImageStateSchema: ContractSchema<DeploymentReusableImageState> = z.enum([
  'available',
  'cleaned',
  'missing',
]);

const deploymentLogStreamSchema: ContractSchema<DeploymentLogStream> = z.enum(['compartment', 'stdout', 'stderr']);
const deploymentLabelSchema: ContractSchema<string> = z
  .string()
  .min(1)
  .max(deploymentLabelMaxLength)
  .refine((value: string): boolean => !deploymentLabelDisallowedPattern.test(value), deploymentLabelValidationMessage);
const deployRequestLabelSchema: ContractSchema<string> = z.string().trim().pipe(deploymentLabelSchema);

type DeploymentSummaryObjectSchema = z.ZodObject<{
  build: typeof resolvedCompartmentServiceBuildConfigSchema;
  completedAt: z.ZodNullable<z.ZodString>;
  createdAt: z.ZodString;
  failureMessage: z.ZodNullable<z.ZodString>;
  health: typeof deploymentRuntimeHealthSchema;
  id: z.ZodString;
  isActive: z.ZodBoolean;
  label: z.ZodNullable<ContractSchema<string>>;
  operation: typeof operationSummarySchema;
  promotionStage: typeof deploymentPromotionStageSchema;
  readiness: typeof resolvedOptionalServiceReadinessConfigSchema;
  reusableImageState: z.ZodOptional<typeof deploymentReusableImageStateSchema>;
  rollbackAvailable: z.ZodBoolean;
  run: typeof resolvedCompartmentServiceRunConfigSchema;
  routeUrl: z.ZodNullable<z.ZodString>;
  serviceName: typeof compartmentServiceNameSchema;
  status: typeof deploymentRuntimeStatusSchema;
}>;

export const deploymentSummarySchema: DeploymentSummaryObjectSchema = z
  .object({
    build: resolvedCompartmentServiceBuildConfigSchema,
    id: z.string().min(1),
    serviceName: compartmentServiceNameSchema,
    status: deploymentRuntimeStatusSchema,
    health: deploymentRuntimeHealthSchema,
    routeUrl: z.string().url().nullable(),
    failureMessage: z.string().min(1).nullable(),
    isActive: z.boolean(),
    label: deploymentLabelSchema.nullable(),
    createdAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
    operation: operationSummarySchema,
    promotionStage: deploymentPromotionStageSchema,
    readiness: resolvedOptionalServiceReadinessConfigSchema,
    reusableImageState: deploymentReusableImageStateSchema.optional(),
    rollbackAvailable: z.boolean(),
    run: resolvedCompartmentServiceRunConfigSchema,
  })
  .strict();

export const deploymentLogLineSchema: ContractSchema<DeploymentLogLine> = z
  .object({
    deploymentId: z.string().min(1),
    environmentName: environmentNameSchema,
    message: z.string(),
    serviceName: compartmentServiceNameSchema,
    stream: deploymentLogStreamSchema,
    timestamp: z.string().datetime(),
  })
  .strict();

export const deployRequestSchema: ContractSchema<DeployRequest, DeployRequestInput> = z
  .object({
    descriptor: compartmentAuthoredDescriptorSchema,
    environmentName: environmentNameSchema.optional(),
    label: deployRequestLabelSchema.optional(),
    onboardingSessionId: z.string().min(1).optional(),
    routes: compartmentRoutesFileSchema.optional(),
    serviceName: compartmentServiceNameSchema.optional(),
    sourceUploadId: sourceUploadIdSchema,
  })
  .strict();

export const deployResponseSchema: ContractSchema<DeployResponse> = z
  .object({
    deploymentRunId: z.string().min(1),
    deployments: z.array(deploymentSummarySchema),
    environment: environmentSummarySchema,
    project: projectSummarySchema,
    resources: z.array(resourceSummarySchema),
  })
  .strict();
