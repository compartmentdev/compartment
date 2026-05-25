import { z } from 'zod';
import { type DeploymentLogLine, deploymentLogLineSchema } from './deployments.contract';
import { compartmentProjectNameSchema, compartmentServiceNameSchema } from './compartment-descriptor.contract';
import { environmentNameSchema } from './environments.contract';
import { logTailLineLimit } from './logs.contract';
import {
  compartmentServiceReadinessTypeValues,
  resolvedOptionalServiceReadinessConfigSchema,
  resolvedServiceReadinessConfigSchema,
  type CompartmentServiceReadinessType,
  type ResolvedOptionalServiceReadinessConfig,
  type ResolvedServiceReadinessConfig,
} from './service-readiness.contract';
import {
  resolvedCompartmentServiceRunConfigSchema,
  type ResolvedCompartmentServiceRunConfig,
} from './service-run.contract';
import {
  type RuntimeActiveDeployment,
  type RuntimeDrainState,
  runtimeActiveDeploymentSchema,
} from './runtime-shared.contract';
import type { ContractSchema } from './schema.types';

export interface NodePreviousDeployment {
  upstreamPort: number;
}

interface NodePrepareDeploymentRequest {
  deploymentId: string;
  environmentId: string;
  environmentName: string;
  imageRef: string;
  previousDeployment?: NodePreviousDeployment | undefined;
  projectId: string;
  projectName: string;
  readiness: ResolvedOptionalServiceReadinessConfig;
  run: ResolvedCompartmentServiceRunConfig;
  routeHost: string;
  serviceId: string;
  runtimeEnv: Record<string, string>;
  serviceName: string;
}

interface NodePrepareDeploymentResponse extends RuntimeActiveDeployment {
  startedAt: string;
}

export interface NodeInspectDeploymentReadinessFields {
  readinessPath?: string | undefined;
  readinessTimeoutMs?: number | undefined;
  readinessType?: CompartmentServiceReadinessType | undefined;
}

export type NodeDeployRequest = NodePrepareDeploymentRequest;
export type NodeDeployResponse = NodePrepareDeploymentResponse;

export interface NodeDrainDeploymentRequest {
  containerId: string;
  deploymentId: string;
  drainDeadlineAt?: string | undefined;
}

export interface NodeDrainDeploymentResponse {
  acceptedAt: string;
}

export interface NodeInspectDeploymentQuery {
  deploymentId: string;
  environmentName: string;
  projectName: string;
  readinessPath?: string | undefined;
  readinessTimeoutMs?: number | undefined;
  readinessType?: CompartmentServiceReadinessType | undefined;
  serviceName: string;
}

export type NodeInspectedDeployment = RuntimeActiveDeployment;

export interface NodeInspectDeploymentResponse {
  deployment: NodeInspectedDeployment | null;
}

export interface NodeStopDeploymentRequest {
  containerId: string;
}

export interface NodeStopDeploymentResponse {
  stoppedAt: string;
}

export interface NodeTailLogsQuery {
  containerId: string;
  deploymentId: string;
  environmentName: string;
  serviceName: string;
  since?: string | undefined;
  tailLines?: number | undefined;
}

export interface NodeTailLogsResponse {
  lines: DeploymentLogLine[];
}

export const nodeDeployPathname: string = '/internal/deployments/deploy';
export const nodeDrainDeploymentPathname: string = '/internal/deployments/drain';
export const nodeInspectDeploymentPathname: string = '/internal/deployments/inspect';
export const nodeStopDeploymentPathname: string = '/internal/deployments/stop';
export const nodeTailLogsPathname: string = '/internal/deployments/logs';

const nodePrepareDeploymentRequestSchema: ContractSchema<NodePrepareDeploymentRequest> = z
  .object({
    deploymentId: z.string().min(1),
    environmentId: z.string().min(1),
    environmentName: environmentNameSchema,
    imageRef: z.string().min(1),
    previousDeployment: z
      .object({
        upstreamPort: z.number().int().positive(),
      })
      .strict()
      .optional(),
    projectId: z.string().min(1),
    projectName: compartmentProjectNameSchema,
    readiness: resolvedOptionalServiceReadinessConfigSchema,
    run: resolvedCompartmentServiceRunConfigSchema,
    routeHost: z.string().min(1),
    serviceId: z.string().min(1),
    runtimeEnv: z.record(z.string(), z.string()),
    serviceName: compartmentServiceNameSchema,
  })
  .strict();

const nodePrepareDeploymentResponseSchema: ContractSchema<NodePrepareDeploymentResponse> = z
  .object({
    startedAt: z.string().datetime(),
  })
  .merge(runtimeActiveDeploymentSchema)
  .strict();

export const nodeDeployRequestSchema: ContractSchema<NodeDeployRequest> = nodePrepareDeploymentRequestSchema;
export const nodeDeployResponseSchema: ContractSchema<NodeDeployResponse> = nodePrepareDeploymentResponseSchema;

export const nodeDrainDeploymentRequestSchema: ContractSchema<NodeDrainDeploymentRequest> = z
  .object({
    containerId: z.string().min(1),
    deploymentId: z.string().min(1),
    drainDeadlineAt: z.string().datetime().optional(),
  })
  .strict();

export const nodeDrainDeploymentResponseSchema: ContractSchema<NodeDrainDeploymentResponse> = z
  .object({
    acceptedAt: z.string().datetime(),
  })
  .strict();

const nodeInspectedDeploymentSchema: ContractSchema<NodeInspectedDeployment> = runtimeActiveDeploymentSchema;
const nodeInspectReadinessTypeSchema: ContractSchema<CompartmentServiceReadinessType> = z.enum(
  compartmentServiceReadinessTypeValues,
);

export const nodeInspectDeploymentQuerySchema: ContractSchema<NodeInspectDeploymentQuery> = z
  .object({
    deploymentId: z.string().min(1),
    environmentName: environmentNameSchema,
    projectName: compartmentProjectNameSchema,
    readinessPath: z.string().min(1).optional(),
    readinessTimeoutMs: z.coerce.number().int().positive().optional(),
    readinessType: nodeInspectReadinessTypeSchema.optional(),
    serviceName: compartmentServiceNameSchema,
  })
  .strict()
  .superRefine((query: NodeInspectDeploymentQuery, context: z.RefinementCtx): void => {
    if (!hasAnyNodeInspectReadinessField(query) || hasCompleteNodeInspectReadinessFields(query)) {
      return;
    }

    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'readinessPath, readinessTimeoutMs, and readinessType must be provided together.',
      path: ['readinessPath'],
    });
  });

export const nodeInspectDeploymentResponseSchema: ContractSchema<NodeInspectDeploymentResponse> = z
  .object({
    deployment: nodeInspectedDeploymentSchema.nullable(),
  })
  .strict();

export const nodeStopDeploymentRequestSchema: ContractSchema<NodeStopDeploymentRequest> = z
  .object({
    containerId: z.string().min(1),
  })
  .strict();

export const nodeStopDeploymentResponseSchema: ContractSchema<NodeStopDeploymentResponse> = z
  .object({
    stoppedAt: z.string().datetime(),
  })
  .strict();

export const nodeTailLogsQuerySchema: ContractSchema<NodeTailLogsQuery> = z
  .object({
    containerId: z.string().min(1),
    deploymentId: z.string().min(1),
    environmentName: environmentNameSchema,
    serviceName: compartmentServiceNameSchema,
    since: z.string().datetime().optional(),
    tailLines: z.coerce.number().int().positive().max(logTailLineLimit).optional(),
  })
  .strict();

export const nodeTailLogsResponseSchema: ContractSchema<NodeTailLogsResponse> = z
  .object({
    lines: z.array(deploymentLogLineSchema),
  })
  .strict();

export function buildNodeDrainDeploymentRequest(drain: RuntimeDrainState): NodeDrainDeploymentRequest {
  return {
    containerId: drain.drainingContainerId,
    deploymentId: drain.drainingDeploymentId,
    ...(drain.drainDeadlineAt !== undefined ? { drainDeadlineAt: drain.drainDeadlineAt } : {}),
  };
}

export function buildNodeInspectReadinessFields(
  readiness: ResolvedOptionalServiceReadinessConfig | undefined,
): NodeInspectDeploymentReadinessFields {
  if (readiness === undefined || readiness === null) {
    return {};
  }

  return { readinessPath: readiness.path, readinessTimeoutMs: readiness.timeoutMs, readinessType: readiness.type };
}

export function readNodeInspectReadiness(query: NodeInspectDeploymentQuery): ResolvedServiceReadinessConfig | null {
  if (!hasCompleteNodeInspectReadinessFields(query)) {
    return null;
  }

  return resolvedServiceReadinessConfigSchema.parse({
    path: query.readinessPath,
    timeoutMs: query.readinessTimeoutMs,
    type: query.readinessType,
  });
}

function hasAnyNodeInspectReadinessField(query: NodeInspectDeploymentQuery): boolean {
  return (
    query.readinessPath !== undefined || query.readinessTimeoutMs !== undefined || query.readinessType !== undefined
  );
}

function hasCompleteNodeInspectReadinessFields(
  query: NodeInspectDeploymentQuery,
): query is NodeInspectDeploymentQuery &
  Required<Pick<NodeInspectDeploymentQuery, 'readinessPath' | 'readinessTimeoutMs' | 'readinessType'>> {
  return (
    query.readinessPath !== undefined && query.readinessTimeoutMs !== undefined && query.readinessType !== undefined
  );
}
