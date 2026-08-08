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
import { tenantSecretEnvironmentSchema, type TenantSecretEnvironment } from './internal-tenant-secret.contract';

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
  buildEnv: TenantSecretEnvironment;
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
  queue: WorkerBuildQueueObservation;
}

export interface WorkerBuildQueueObservation {
  activeBuildCount: number;
  queueDepth: number;
  waitTimeMs: number | null;
}

export interface WorkerClaimDeploymentRequest {
  maximumConcurrentBuilds: number;
  maximumConcurrentBuildsPerOrganization: number;
}

interface LegacyWorkerClaimDeploymentRequest {
  maximumConcurrentBuilds: number;
  maximumConcurrentBuildsPerProject: number;
}

type WorkerClaimDeploymentWireRequest = WorkerClaimDeploymentRequest | LegacyWorkerClaimDeploymentRequest;

export interface WorkerRecoverOrphanedBuildClaimsRequest {
  claimTimeoutMs: number;
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

export const workerClaimDeploymentRequestSchema: ContractSchema<WorkerClaimDeploymentRequest> = z
  .object({
    maximumConcurrentBuilds: z.number().int().positive(),
    maximumConcurrentBuildsPerOrganization: z.number().int().positive(),
  })
  .strict();

// Compatibility for API-first rolling upgrades from 0.10.x. Remove in 0.12.0 after the 0.11.x upgrade window.
const legacyWorkerClaimDeploymentRequestSchema: ContractSchema<LegacyWorkerClaimDeploymentRequest> = z
  .object({
    maximumConcurrentBuilds: z.number().int().positive(),
    maximumConcurrentBuildsPerProject: z.number().int().positive(),
  })
  .strict();

export const workerClaimDeploymentRollingUpgradeRequestSchema: ContractSchema<
  WorkerClaimDeploymentRequest,
  WorkerClaimDeploymentWireRequest
> = z.union([workerClaimDeploymentRequestSchema, legacyWorkerClaimDeploymentRequestSchema]).transform(
  (request: WorkerClaimDeploymentWireRequest): WorkerClaimDeploymentRequest =>
    'maximumConcurrentBuildsPerOrganization' in request
      ? request
      : {
          maximumConcurrentBuilds: request.maximumConcurrentBuilds,
          maximumConcurrentBuildsPerOrganization: request.maximumConcurrentBuildsPerProject,
        },
);

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
    buildEnv: tenantSecretEnvironmentSchema,
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
    queue: z
      .object({
        activeBuildCount: z.number().int().nonnegative(),
        queueDepth: z.number().int().nonnegative(),
        waitTimeMs: z.number().int().nonnegative().nullable(),
      })
      .strict(),
  })
  .strict();

export const workerRecoverOrphanedBuildClaimsRequestSchema: ContractSchema<WorkerRecoverOrphanedBuildClaimsRequest> = z
  .object({ claimTimeoutMs: z.number().int().positive() })
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
