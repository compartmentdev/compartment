import { z } from 'zod';
import {
  compartmentProjectNameSchema,
  compartmentServiceKindSchema,
  compartmentServiceNameSchema,
  type CompartmentServiceKind,
} from './compartment-descriptor.contract';
import {
  deploymentRunLogLevelSchema,
  deploymentRunStepKeySchema,
  deploymentRunStepStatusSchema,
  type DeploymentRunLogLevel,
  type DeploymentRunStepKey,
  type DeploymentRunStepStatus,
} from './deployment-run.contract';
import { environmentNameSchema, type DeploymentLogStream } from './deployments.contract';
import type { ContractSchema } from './schema.types';
import {
  resolvedCompartmentServiceBuildConfigSchema,
  type ResolvedCompartmentServiceBuildConfig,
} from './service-build.contract';
import {
  resolvedCompartmentServiceRunConfigSchema,
  type ResolvedCompartmentServiceRunConfig,
} from './service-run.contract';

export interface WorkerProjectServiceSummary {
  build: ResolvedCompartmentServiceBuildConfig;
  id: string;
  kind: CompartmentServiceKind;
  name: string;
  path: string;
}

export interface WorkerBuildArtifactSummary {
  id: string;
  imageRef: string | null;
  sourceDigest: string;
}

export interface WorkerClaimedDeployment {
  artifact: WorkerBuildArtifactSummary;
  buildEnv: Record<string, string>;
  deploymentId: string;
  deploymentRunId: string;
  environmentId: string;
  environmentName: string;
  projectId: string;
  projectName: string;
  requiresSourceRoutesFile: boolean;
  routeHost: string;
  run: ResolvedCompartmentServiceRunConfig;
  service: WorkerProjectServiceSummary;
}

export interface WorkerClaimDeploymentResponse {
  deployment: WorkerClaimedDeployment | null;
}

export interface WorkerRecoverOrphanedBuildClaimsResponse {
  requeuedDeploymentCount: number;
}

export interface WorkerFailDeploymentRequest {
  deploymentId: string;
  imageRef?: string | undefined;
  message: string;
}

export interface WorkerAppendDeploymentEventRequest {
  deploymentId: string;
  deploymentRunId: string;
  level: DeploymentRunLogLevel;
  message: string;
  status?: DeploymentRunStepStatus | undefined;
  stepKey: DeploymentRunStepKey;
  stream: DeploymentLogStream;
  timestamp?: string | undefined;
}

export const workerAppendDeploymentEventPathname: string = '/internal/deployments/events';
export const workerClaimNextDeploymentPathname: string = '/internal/deployments/claim-next';
export const workerFailDeploymentPathname: string = '/internal/deployments/fail';
export const workerRecoverOrphanedBuildClaimsPathname: string = '/internal/deployments/requeue-orphaned-builds';

const workerProjectServiceSummarySchema: ContractSchema<WorkerProjectServiceSummary> = z
  .object({
    build: resolvedCompartmentServiceBuildConfigSchema,
    id: z.string().min(1),
    kind: compartmentServiceKindSchema,
    name: compartmentServiceNameSchema,
    path: z.string().min(1),
  })
  .strict();

const workerBuildArtifactSummarySchema: ContractSchema<WorkerBuildArtifactSummary> = z
  .object({
    id: z.string().min(1),
    imageRef: z.string().min(1).nullable(),
    sourceDigest: z.string().min(1),
  })
  .strict();

const workerClaimedDeploymentSchema: ContractSchema<WorkerClaimedDeployment> = z
  .object({
    artifact: workerBuildArtifactSummarySchema,
    buildEnv: z.record(z.string(), z.string()),
    deploymentId: z.string().min(1),
    deploymentRunId: z.string().min(1),
    environmentId: z.string().min(1),
    environmentName: environmentNameSchema,
    projectId: z.string().min(1),
    projectName: compartmentProjectNameSchema,
    requiresSourceRoutesFile: z.boolean(),
    routeHost: z.string().min(1),
    run: resolvedCompartmentServiceRunConfigSchema,
    service: workerProjectServiceSummarySchema,
  })
  .strict();

export const workerClaimDeploymentResponseSchema: ContractSchema<WorkerClaimDeploymentResponse> = z
  .object({
    deployment: workerClaimedDeploymentSchema.nullable(),
  })
  .strict();

export const workerRecoverOrphanedBuildClaimsResponseSchema: ContractSchema<WorkerRecoverOrphanedBuildClaimsResponse> =
  z.object({ requeuedDeploymentCount: z.number().int().nonnegative() }).strict();

export const workerFailDeploymentRequestSchema: ContractSchema<WorkerFailDeploymentRequest> = z
  .object({
    deploymentId: z.string().min(1),
    imageRef: z.string().min(1).optional(),
    message: z.string().min(1),
  })
  .strict();

export const workerAppendDeploymentEventRequestSchema: ContractSchema<WorkerAppendDeploymentEventRequest> = z
  .object({
    deploymentId: z.string().min(1),
    deploymentRunId: z.string().min(1),
    level: deploymentRunLogLevelSchema,
    message: z.string().min(1),
    status: deploymentRunStepStatusSchema.optional(),
    stepKey: deploymentRunStepKeySchema,
    stream: z.enum(['compartment', 'stdout', 'stderr']),
    timestamp: z.string().datetime().optional(),
  })
  .strict();
