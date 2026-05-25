import { z } from 'zod';
import { compartmentProjectNameSchema, compartmentServiceNameSchema } from './compartment-descriptor.contract';
import { environmentNameSchema } from './environments.contract';
import { logTailLineLimit } from './logs.contract';
import { resourceRuntimeStatusSchema, type ResourceLogLine, type ResourceRuntimeStatus } from './resources.contract';
import type { ContractSchema } from './schema.types';

export const nodeResourceDeletePathname: string = '/internal/resources/delete';
export const nodeResourceLogsPathname: string = '/internal/resources/logs';
export const nodeResourceOperationBackupPathname: string = '/internal/resources/operations/backup';
export const nodeResourceOperationRestorePathname: string = '/internal/resources/operations/restore';
export const nodeResourceReconcilePathname: string = '/internal/resources/reconcile';
export const nodeResourceRestartPolicyPathname: string = '/internal/resources/restart-policy';
export const nodeResourceStartPathname: string = '/internal/resources/start';
export const nodeResourceStopPathname: string = '/internal/resources/stop';

export interface NodeResourceEnvValue {
  keyName: string;
  value: string;
}

export interface NodeResourceVolume {
  mountPath: string;
  name: string;
}

export interface NodeResourceReadiness {
  port: number;
  timeoutMs: number;
  type: 'tcp';
}

export interface NodeResourceRestart {
  policy: 'no' | 'on-failure' | 'unless-stopped';
}

export interface NodeResourceRuntimeDefinition {
  command: string[];
  env: NodeResourceEnvValue[];
  image: string;
  ports: number[];
  readiness: NodeResourceReadiness | null;
  restart: NodeResourceRestart;
}

export interface NodeResourceOperationDefinition {
  command: string;
  env: NodeResourceEnvValue[];
  image: string;
}

export interface NodeResourceRequest {
  definition: NodeResourceRuntimeDefinition;
  environmentId: string;
  environmentName: string;
  hostname: string;
  projectId: string;
  projectName: string;
  resourceName: string;
  volumes: NodeResourceVolume[];
}

export interface NodeResourceOperationRequest {
  artifactHostPath: string;
  definition: NodeResourceOperationDefinition;
  environmentId: string;
  environmentName: string;
  projectId: string;
  projectName: string;
  readiness: NodeResourceReadiness | null;
  resourceHostname: string;
  resourceName: string;
}

export interface NodeResourceOperationResponse {
  stderr: string;
  stdout: string;
}

export interface NodeResourceResponse {
  containerId: string | null;
  hostname: string;
  status: ResourceRuntimeStatus;
}

export interface NodeResourceLifecycleRequest {
  environmentName: string;
  projectName: string;
  resourceName: string;
  volumes: NodeResourceVolume[];
}

export interface NodeResourceStopRequest extends NodeResourceLifecycleRequest {
  containerId: string;
}

export interface NodeResourceDeleteRequest extends NodeResourceLifecycleRequest {
  containerId: string | null;
  deleteData?: boolean | undefined;
}

export interface NodeResourceRestartPolicyRequest {
  containerId: string;
  environmentName: string;
  projectName: string;
  resourceName: string;
  restart: NodeResourceRestart;
}

export interface NodeResourceLogsQuery {
  containerId: string;
  environmentName: string;
  resourceName: string;
  since?: string | undefined;
  tailLines?: number | undefined;
}

export interface NodeResourceLogsResponse {
  lines: ResourceLogLine[];
}

const nodeResourceEnvValueSchema: ContractSchema<NodeResourceEnvValue> = z
  .object({
    keyName: z.string().min(1),
    value: z.string(),
  })
  .strict();
export const nodeResourceVolumeSchema: ContractSchema<NodeResourceVolume> = z
  .object({
    mountPath: z.string().min(1),
    name: z.string().min(1),
  })
  .strict();
const nodeResourceReadinessSchema: ContractSchema<NodeResourceReadiness> = z
  .object({
    port: z.number().int().min(1).max(65_535),
    timeoutMs: z.number().int().positive().max(300_000),
    type: z.literal('tcp'),
  })
  .strict();
const nodeResourceRestartSchema: ContractSchema<NodeResourceRestart> = z
  .object({
    policy: z.enum(['no', 'on-failure', 'unless-stopped']),
  })
  .strict();
const nodeResourceRuntimeDefinitionSchema: ContractSchema<NodeResourceRuntimeDefinition> = z
  .object({
    command: z.array(z.string().min(1)),
    env: z.array(nodeResourceEnvValueSchema),
    image: z.string().min(1),
    ports: z.array(z.number().int().min(1).max(65_535)),
    readiness: nodeResourceReadinessSchema.nullable(),
    restart: nodeResourceRestartSchema,
  })
  .strict();
const nodeResourceOperationDefinitionSchema: ContractSchema<NodeResourceOperationDefinition> = z
  .object({
    command: z.string().min(1),
    env: z.array(nodeResourceEnvValueSchema),
    image: z.string().min(1),
  })
  .strict();

export const nodeResourceRequestSchema: ContractSchema<NodeResourceRequest> = z
  .object({
    definition: nodeResourceRuntimeDefinitionSchema,
    environmentId: z.string().min(1),
    environmentName: environmentNameSchema,
    hostname: z.string().min(1),
    projectId: z.string().min(1),
    projectName: compartmentProjectNameSchema,
    resourceName: compartmentServiceNameSchema,
    volumes: z.array(nodeResourceVolumeSchema),
  })
  .strict();
export const nodeResourceOperationRequestSchema: ContractSchema<NodeResourceOperationRequest> = z
  .object({
    artifactHostPath: z.string().min(1),
    definition: nodeResourceOperationDefinitionSchema,
    environmentId: z.string().min(1),
    environmentName: environmentNameSchema,
    projectId: z.string().min(1),
    projectName: compartmentProjectNameSchema,
    readiness: nodeResourceReadinessSchema.nullable(),
    resourceHostname: z.string().min(1),
    resourceName: compartmentServiceNameSchema,
  })
  .strict();
export const nodeResourceResponseSchema: ContractSchema<NodeResourceResponse> = z
  .object({
    containerId: z.string().min(1).nullable(),
    hostname: z.string().min(1),
    status: resourceRuntimeStatusSchema,
  })
  .strict();
export const nodeResourceOperationResponseSchema: ContractSchema<NodeResourceOperationResponse> = z
  .object({
    stderr: z.string(),
    stdout: z.string(),
  })
  .strict();
export const nodeResourceStopRequestSchema: ContractSchema<NodeResourceStopRequest> = z
  .object({
    containerId: z.string().min(1),
    environmentName: environmentNameSchema,
    projectName: compartmentProjectNameSchema,
    resourceName: compartmentServiceNameSchema,
    volumes: z.array(nodeResourceVolumeSchema),
  })
  .strict();
export const nodeResourceDeleteRequestSchema: ContractSchema<NodeResourceDeleteRequest> = z
  .object({
    containerId: z.string().min(1).nullable(),
    deleteData: z.boolean().optional(),
    environmentName: environmentNameSchema,
    projectName: compartmentProjectNameSchema,
    resourceName: compartmentServiceNameSchema,
    volumes: z.array(nodeResourceVolumeSchema),
  })
  .strict();
export const nodeResourceRestartPolicyRequestSchema: ContractSchema<NodeResourceRestartPolicyRequest> = z
  .object({
    containerId: z.string().min(1),
    environmentName: environmentNameSchema,
    projectName: compartmentProjectNameSchema,
    resourceName: compartmentServiceNameSchema,
    restart: nodeResourceRestartSchema,
  })
  .strict();
export const nodeResourceLogsQuerySchema: ContractSchema<NodeResourceLogsQuery> = z
  .object({
    containerId: z.string().min(1),
    environmentName: environmentNameSchema,
    resourceName: compartmentServiceNameSchema,
    since: z.string().datetime().optional(),
    tailLines: z.coerce.number().int().positive().max(logTailLineLimit).optional(),
  })
  .strict();

const nodeResourceLogLineSchema: ContractSchema<ResourceLogLine> = z
  .object({
    message: z.string(),
    resourceName: compartmentServiceNameSchema,
    stream: z.enum(['stdout', 'stderr']),
    timestamp: z.string().datetime(),
  })
  .strict();

export const nodeResourceLogsResponseSchema: ContractSchema<NodeResourceLogsResponse> = z
  .object({
    lines: z.array(nodeResourceLogLineSchema),
  })
  .strict();
