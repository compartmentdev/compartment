import { z } from 'zod';
import { compartmentServiceNameSchema } from './compartment-descriptor.contract';
import {
  type DeploymentLogStream,
  type DeploymentRuntimeStatus,
  deploymentRuntimeStatusSchema,
} from './deployments.contract';
import {
  type DeploymentReadEnvironmentSummary,
  type DeploymentReadProjectSummary,
  type DeploymentReadSummary,
  deploymentReadEnvironmentSummarySchema,
  deploymentReadProjectSummarySchema,
  deploymentReadSummarySchema,
} from './deployment-read.contract';
import { deploymentLogsQueryShape } from './deployment-logs-query-shape.contract';
import type { ContractSchema } from './schema.types';

export type DeploymentRunTriggerType = 'manual' | 'autosync' | 'promote' | 'rollback' | 'start';
export type DeploymentRunStepKey =
  | 'queued'
  | 'preparing_source'
  | 'building_image'
  | 'publishing_image'
  | 'release'
  | 'completed';
export type DeploymentRunStepStatus = 'running' | 'succeeded' | 'failed' | 'skipped';
export type DeploymentRunLogLevel = 'info' | 'error';

export interface DeploymentRunTriggerSummary {
  branchName: string | null;
  commitSha: string | null;
  repositoryName: string | null;
  repositoryOwner: string | null;
  sourceEventId: string | null;
  sourceResolutionTaskId: string | null;
  type: DeploymentRunTriggerType;
}

export interface DeploymentRunSummary {
  completedAt: string | null;
  createdAt: string;
  failureMessage: string | null;
  id: string;
  label: string | null;
  status: DeploymentRuntimeStatus;
  trigger: DeploymentRunTriggerSummary;
}

export interface DeploymentRunStepSummary {
  completedAt: string | null;
  createdAt: string;
  deploymentId: string | null;
  message: string;
  serviceName: string | null;
  status: DeploymentRunStepStatus;
  stepKey: DeploymentRunStepKey;
}

export interface DeploymentRunLogLine {
  deploymentId: string | null;
  level: DeploymentRunLogLevel;
  message: string;
  serviceName: string | null;
  stepKey: DeploymentRunStepKey;
  stream: DeploymentLogStream;
  timestamp: string;
}

interface DeploymentRunLogsQueryBase {
  environmentName?: string | undefined;
  projectName: string;
  serviceName?: string | undefined;
  since?: string | undefined;
  tailLines?: number | undefined;
}

export interface DeploymentLatestRunLogsQuery extends DeploymentRunLogsQueryBase {
  selector: 'latest';
}

export interface DeploymentRunLogsByIdQuery extends DeploymentRunLogsQueryBase {
  deploymentRunId: string;
  selector: 'run';
}

export type DeploymentRunLogsQuery = DeploymentLatestRunLogsQuery | DeploymentRunLogsByIdQuery;

export interface DeploymentRunLogsResponse {
  deployment: DeploymentRunSummary;
  deployments: DeploymentReadSummary[];
  environment: DeploymentReadEnvironmentSummary;
  lines: DeploymentRunLogLine[];
  project: DeploymentReadProjectSummary;
  steps: DeploymentRunStepSummary[];
}

const deploymentRunTriggerTypeSchema: ContractSchema<DeploymentRunTriggerType> = z.enum([
  'manual',
  'autosync',
  'promote',
  'rollback',
  'start',
]);
export const deploymentRunStepKeySchema: ContractSchema<DeploymentRunStepKey> = z.enum([
  'queued',
  'preparing_source',
  'building_image',
  'publishing_image',
  'release',
  'completed',
]);
export const deploymentRunStepStatusSchema: ContractSchema<DeploymentRunStepStatus> = z.enum([
  'running',
  'succeeded',
  'failed',
  'skipped',
]);
export const deploymentRunLogLevelSchema: ContractSchema<DeploymentRunLogLevel> = z.enum(['info', 'error']);
const nullableTextSchema: ContractSchema<string | null> = z.string().min(1).nullable();
const deploymentLogStreamSchema: ContractSchema<DeploymentLogStream> = z.enum(['compartment', 'stdout', 'stderr']);

const deploymentRunTriggerSummarySchema: ContractSchema<DeploymentRunTriggerSummary> = z
  .object({
    branchName: nullableTextSchema,
    commitSha: nullableTextSchema,
    repositoryName: nullableTextSchema,
    repositoryOwner: nullableTextSchema,
    sourceEventId: nullableTextSchema,
    sourceResolutionTaskId: nullableTextSchema,
    type: deploymentRunTriggerTypeSchema,
  })
  .strict();

const deploymentRunSummarySchema: ContractSchema<DeploymentRunSummary> = z
  .object({
    completedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    failureMessage: nullableTextSchema,
    id: z.string().min(1),
    label: z.string().min(1).max(100).nullable(),
    status: deploymentRuntimeStatusSchema,
    trigger: deploymentRunTriggerSummarySchema,
  })
  .strict();

const deploymentRunStepSummarySchema: ContractSchema<DeploymentRunStepSummary> = z
  .object({
    completedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    deploymentId: nullableTextSchema,
    message: z.string().min(1),
    serviceName: compartmentServiceNameSchema.nullable(),
    status: deploymentRunStepStatusSchema,
    stepKey: deploymentRunStepKeySchema,
  })
  .strict();

const deploymentRunLogLineSchema: ContractSchema<DeploymentRunLogLine> = z
  .object({
    deploymentId: nullableTextSchema,
    level: deploymentRunLogLevelSchema,
    message: z.string(),
    serviceName: compartmentServiceNameSchema.nullable(),
    stepKey: deploymentRunStepKeySchema,
    stream: deploymentLogStreamSchema,
    timestamp: z.string().datetime(),
  })
  .strict();

type DeploymentLatestRunLogsQuerySchemaShape = z.ZodRawShape &
  typeof deploymentLogsQueryShape & {
    selector: z.ZodLiteral<'latest'>;
  };

type DeploymentRunLogsByIdQuerySchemaShape = z.ZodRawShape &
  typeof deploymentLogsQueryShape & {
    deploymentRunId: z.ZodString;
    selector: z.ZodLiteral<'run'>;
  };

const deploymentLatestRunLogsQuerySchema: z.ZodObject<DeploymentLatestRunLogsQuerySchemaShape> = z
  .object({
    ...deploymentLogsQueryShape,
    selector: z.literal('latest'),
  })
  .strict();

const deploymentRunLogsByIdQuerySchema: z.ZodObject<DeploymentRunLogsByIdQuerySchemaShape> = z
  .object({
    deploymentRunId: z.string().min(1),
    ...deploymentLogsQueryShape,
    selector: z.literal('run'),
  })
  .strict();

export const deploymentRunLogsQuerySchema: ContractSchema<DeploymentRunLogsQuery> = z.discriminatedUnion('selector', [
  deploymentLatestRunLogsQuerySchema,
  deploymentRunLogsByIdQuerySchema,
]) as z.ZodType<DeploymentRunLogsQuery>;

export const deploymentRunLogsResponseSchema: ContractSchema<DeploymentRunLogsResponse> = z
  .object({
    deployment: deploymentRunSummarySchema,
    deployments: z.array(deploymentReadSummarySchema),
    environment: deploymentReadEnvironmentSummarySchema,
    lines: z.array(deploymentRunLogLineSchema),
    project: deploymentReadProjectSummarySchema,
    steps: z.array(deploymentRunStepSummarySchema),
  })
  .strict();

export function formatDeploymentRunLogLineText(line: Readonly<DeploymentRunLogLine>): string {
  const servicePrefix: string = line.serviceName === null ? '' : `[${line.serviceName}] `;
  return `${line.timestamp} ${servicePrefix}${line.stream} ${line.message}`;
}

export function readDeploymentRunTriggerRepositoryLabel(trigger: Readonly<DeploymentRunTriggerSummary>): string | null {
  if (trigger.repositoryOwner === null || trigger.repositoryName === null) {
    return null;
  }

  return `${trigger.repositoryOwner}/${trigger.repositoryName}`;
}
