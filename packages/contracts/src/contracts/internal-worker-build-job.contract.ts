import { z } from 'zod';
import {
  compartmentServiceKindSchema,
  compartmentServiceNameSchema,
  type CompartmentServiceKind,
} from './compartment-descriptor.contract';
import type { ContractSchema } from './schema.types';
import {
  resolvedCompartmentServiceBuildConfigSchema,
  type ResolvedCompartmentServiceBuildConfig,
} from './service-build.contract';
import {
  resolvedCompartmentServiceRunConfigSchema,
  type ResolvedCompartmentServiceRunConfig,
} from './service-run.contract';

export interface WorkerBuildJobRegistryCredentials {
  password: string;
  serverAddress: string;
  username: string;
}

export interface WorkerBuildJobDockerInput {
  buildCacheKey?: string | undefined;
  buildEnv?: Record<string, string> | undefined;
  buildSecretFingerprint?: string | undefined;
  cacheImageRef?: string | undefined;
  imageTag: string;
  labels?: Record<string, string> | undefined;
  pushImageInsecureRegistry: boolean;
  pushImageTag: string;
  pushRegistryCredentials: WorkerBuildJobRegistryCredentials;
  scanRegistryCredentials?: WorkerBuildJobRegistryCredentials | undefined;
}

export interface WorkerBuildJobServiceInput {
  build: ResolvedCompartmentServiceBuildConfig;
  kind: CompartmentServiceKind;
  name: string;
  path: string;
  requiresRoutesFile: boolean;
  run: ResolvedCompartmentServiceRunConfig;
}

export interface WorkerSourceBuildJobInput {
  apiUrl: string;
  artifactId: string;
  docker: WorkerBuildJobDockerInput;
  kind: 'source';
  service: WorkerBuildJobServiceInput;
}

export interface WorkerRegistryVerificationBuildJobInput {
  docker: WorkerBuildJobDockerInput;
  dockerfile: string;
  kind: 'registry-verification';
}

export type WorkerBuildJobInput = WorkerRegistryVerificationBuildJobInput | WorkerSourceBuildJobInput;

export interface WorkerBuildJobProgressLine {
  message: string;
  stream: 'stderr' | 'stdout';
}

export interface WorkerBuildJobResult {
  imageRef: string;
  pushed: boolean;
}

export interface WorkerBuildJobLogResult {
  result: WorkerBuildJobResult;
  type: 'result';
}

export interface WorkerBuildJobLogFailure {
  message: string;
  type: 'failure';
}

export interface WorkerBuildJobLogProgress {
  progress: WorkerBuildJobProgressLine;
  type: 'progress';
}

export type WorkerBuildJobLogRecord = WorkerBuildJobLogFailure | WorkerBuildJobLogProgress | WorkerBuildJobLogResult;

const workerBuildJobRegistryCredentialsSchema: ContractSchema<WorkerBuildJobRegistryCredentials> = z
  .object({
    password: z.string().min(1),
    serverAddress: z.string().min(1),
    username: z.string().min(1),
  })
  .strict();

const workerBuildJobDockerInputSchema: ContractSchema<WorkerBuildJobDockerInput> = z
  .object({
    buildCacheKey: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
    buildEnv: z.record(z.string(), z.string()).optional(),
    buildSecretFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
    cacheImageRef: z.string().min(1).optional(),
    imageTag: z.string().min(1),
    labels: z.record(z.string(), z.string()).optional(),
    pushImageInsecureRegistry: z.boolean(),
    pushImageTag: z.string().min(1),
    pushRegistryCredentials: workerBuildJobRegistryCredentialsSchema,
    scanRegistryCredentials: workerBuildJobRegistryCredentialsSchema.optional(),
  })
  .strict();

const workerBuildJobServiceInputSchema: ContractSchema<WorkerBuildJobServiceInput> = z
  .object({
    build: resolvedCompartmentServiceBuildConfigSchema,
    kind: compartmentServiceKindSchema,
    name: compartmentServiceNameSchema,
    path: z.string().min(1),
    requiresRoutesFile: z.boolean(),
    run: resolvedCompartmentServiceRunConfigSchema,
  })
  .strict();

const workerSourceBuildJobInputSchema: z.ZodObject<{
  apiUrl: z.ZodString;
  artifactId: z.ZodString;
  docker: typeof workerBuildJobDockerInputSchema;
  kind: z.ZodLiteral<'source'>;
  service: typeof workerBuildJobServiceInputSchema;
}> = z
  .object({
    apiUrl: z.string().url(),
    artifactId: z.string().min(1),
    docker: workerBuildJobDockerInputSchema,
    kind: z.literal('source'),
    service: workerBuildJobServiceInputSchema,
  })
  .strict();

const workerRegistryVerificationBuildJobInputSchema: z.ZodObject<{
  docker: typeof workerBuildJobDockerInputSchema;
  dockerfile: z.ZodString;
  kind: z.ZodLiteral<'registry-verification'>;
}> = z
  .object({
    docker: workerBuildJobDockerInputSchema,
    dockerfile: z.string().min(1),
    kind: z.literal('registry-verification'),
  })
  .strict();

export const workerBuildJobInputSchema: ContractSchema<WorkerBuildJobInput> = z.discriminatedUnion('kind', [
  workerRegistryVerificationBuildJobInputSchema,
  workerSourceBuildJobInputSchema,
]);

export const workerBuildJobLogRecordSchema: ContractSchema<WorkerBuildJobLogRecord> = z.discriminatedUnion('type', [
  z.object({ message: z.string().min(1), type: z.literal('failure') }).strict(),
  z
    .object({
      progress: z.object({ message: z.string(), stream: z.enum(['stderr', 'stdout']) }).strict(),
      type: z.literal('progress'),
    })
    .strict(),
  z
    .object({
      result: z.object({ imageRef: z.string().min(1), pushed: z.boolean() }).strict(),
      type: z.literal('result'),
    })
    .strict(),
]);
