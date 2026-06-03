import { z } from 'zod';
import {
  type DeploymentRunLogLevel,
  type DeploymentRunStepKey,
  type DeploymentRunStepStatus,
  deploymentRunLogLevelSchema,
  deploymentRunStepKeySchema,
  deploymentRunStepStatusSchema,
} from './deployment-run.contract';
import {
  environmentNameSchema,
  deploymentPromotionStageSchema,
  type DeploymentLogStream,
  type DeploymentPromotionStage,
} from './deployments.contract';
import {
  compartmentProjectNameSchema,
  compartmentServiceKindSchema,
  compartmentServiceNameSchema,
  type CompartmentServiceKind,
} from './compartment-descriptor.contract';
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
import {
  resolvedOptionalCompartmentServiceReleaseConfigSchema,
  type ResolvedOptionalCompartmentServiceReleaseConfig,
} from './service-release.contract';
import {
  type RuntimeActiveDeployment,
  type RuntimeDrainState,
  type RuntimePreviousDeployment,
  runtimeActiveDeploymentSchema,
  runtimeDrainStateSchema,
  runtimePreviousDeploymentSchema,
} from './runtime-shared.contract';
import { runtimeNetworkIntentSchema, type RuntimeNetworkIntent } from './runtime-node-network.contract';
import type { ContractSchema } from './schema.types';

export interface WorkerNodeSummary {
  id: string;
  name: string;
  nodeSocketPath: string;
}

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
  buildEnv: Record<string, string>;
  deploymentId: string;
  deploymentRunId: string;
  environmentId: string;
  environmentName: string;
  node: WorkerNodeSummary;
  previousDeployment?: RuntimePreviousDeployment | undefined;
  projectId: string;
  projectName: string;
  readiness: ResolvedOptionalServiceReadinessConfig;
  release: ResolvedOptionalCompartmentServiceReleaseConfig;
  requiresSourceRoutesFile: boolean;
  run: ResolvedCompartmentServiceRunConfig;
  artifact: WorkerBuildArtifactSummary;
  routeHost: string;
  runtimeNetwork: RuntimeNetworkIntent;
  runtimeEnv: Record<string, string>;
  service: WorkerProjectServiceSummary;
}

export interface WorkerClaimDeploymentResponse {
  deployment: WorkerClaimedDeployment | null;
}

export const workerAppendDeploymentEventPathname: string = '/internal/deployments/runtime-events';
export const workerClaimNextDeploymentPathname: string = '/internal/deployments/claim-next';
export const workerCompleteDeploymentPathname: string = '/internal/deployments/complete';
export const workerFailDeploymentPathname: string = '/internal/deployments/fail';
export const workerUpdateDeploymentRuntimePathname: string = '/internal/deployments/runtime-state';

export interface WorkerCompleteDeploymentRequest extends RuntimeActiveDeployment {
  deploymentId: string;
  drain?: RuntimeDrainState | undefined;
}

export interface WorkerFailDeploymentRequest {
  deploymentId: string;
  imageRef?: string | undefined;
  message: string;
}

export interface WorkerUpdateDeploymentRuntimeRequest {
  containerId?: string | null | undefined;
  deploymentId: string;
  drain?: RuntimeDrainState | null | undefined;
  promotionStage: DeploymentPromotionStage;
  upstreamHost?: string | null | undefined;
  upstreamPort?: number | null | undefined;
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

export type WorkerUpstreamTargetPresence = 'absent' | 'complete' | 'missing_host' | 'missing_port';
export const workerUpstreamTargetValidationMessage: string = 'upstreamHost and upstreamPort must be provided together.';

const workerNodeSummarySchema: ContractSchema<WorkerNodeSummary> = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    nodeSocketPath: z.string().min(1),
  })
  .strict();

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
    buildEnv: z.record(z.string(), z.string()),
    deploymentId: z.string().min(1),
    deploymentRunId: z.string().min(1),
    environmentId: z.string().min(1),
    environmentName: environmentNameSchema,
    node: workerNodeSummarySchema,
    previousDeployment: runtimePreviousDeploymentSchema.optional(),
    projectId: z.string().min(1),
    projectName: compartmentProjectNameSchema,
    readiness: resolvedOptionalServiceReadinessConfigSchema,
    release: resolvedOptionalCompartmentServiceReleaseConfigSchema,
    requiresSourceRoutesFile: z.boolean(),
    run: resolvedCompartmentServiceRunConfigSchema,
    artifact: workerBuildArtifactSummarySchema,
    routeHost: z.string().min(1),
    runtimeNetwork: runtimeNetworkIntentSchema,
    runtimeEnv: z.record(z.string(), z.string()),
    service: workerProjectServiceSummarySchema,
  })
  .strict();

export const workerClaimDeploymentResponseSchema: ContractSchema<WorkerClaimDeploymentResponse> = z
  .object({
    deployment: workerClaimedDeploymentSchema.nullable(),
  })
  .strict();

export const workerCompleteDeploymentRequestSchema: ContractSchema<WorkerCompleteDeploymentRequest> = z
  .object({
    deploymentId: z.string().min(1),
    drain: runtimeDrainStateSchema.optional(),
  })
  .merge(runtimeActiveDeploymentSchema)
  .strict();

export const workerFailDeploymentRequestSchema: ContractSchema<WorkerFailDeploymentRequest> = z
  .object({
    deploymentId: z.string().min(1),
    imageRef: z.string().min(1).optional(),
    message: z.string().min(1),
  })
  .strict();

export const workerUpdateDeploymentRuntimeRequestSchema: ContractSchema<WorkerUpdateDeploymentRuntimeRequest> = z
  .object({
    containerId: z.string().min(1).nullable().optional(),
    deploymentId: z.string().min(1),
    drain: runtimeDrainStateSchema.nullable().optional(),
    promotionStage: deploymentPromotionStageSchema,
    upstreamHost: z.string().min(1).nullable().optional(),
    upstreamPort: z.number().int().positive().nullable().optional(),
  })
  .strict()
  .superRefine(validateWorkerUpstreamTarget) as ContractSchema<WorkerUpdateDeploymentRuntimeRequest>;

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

function validateWorkerUpstreamTarget(value: WorkerUpdateDeploymentRuntimeRequest, context: z.RefinementCtx): void {
  const upstreamTargetPresence: WorkerUpstreamTargetPresence = readWorkerUpstreamTargetPresence(value);
  if (upstreamTargetPresence === 'absent' || upstreamTargetPresence === 'complete') {
    return;
  }

  context.addIssue({
    code: z.ZodIssueCode.custom,
    message: workerUpstreamTargetValidationMessage,
    path: upstreamTargetPresence === 'missing_port' ? ['upstreamPort'] : ['upstreamHost'],
  });
}

export function readWorkerUpstreamTargetPresence(
  value: Pick<WorkerUpdateDeploymentRuntimeRequest, 'upstreamHost' | 'upstreamPort'>,
): WorkerUpstreamTargetPresence {
  const hasUpstreamHost: boolean = value.upstreamHost !== undefined;
  const hasUpstreamPort: boolean = value.upstreamPort !== undefined;
  if (!hasUpstreamHost && !hasUpstreamPort) {
    return 'absent';
  }
  if (hasUpstreamHost && hasUpstreamPort) {
    return 'complete';
  }

  return hasUpstreamHost ? 'missing_port' : 'missing_host';
}
