import { z } from 'zod';
import type { ContractSchema } from './schema.types';

export type ProductJobClass = 'release' | 'resource-operation';
export type ProductJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'timed-out';

interface ProductJobSpec {
  command: string[];
  env: Record<string, string>;
  image: string;
  namespace: string;
  timeoutMs: number;
}

export interface ReleaseProductJobIntent extends ProductJobSpec {
  deploymentId: string;
  jobClass: 'release';
}

export interface ResourceOperationProductJobIntent extends ProductJobSpec {
  jobClass: 'resource-operation';
  operationId: string;
}

export type ProductJobIntent = ReleaseProductJobIntent | ResourceOperationProductJobIntent;

export interface WorkerClaimProductJobResponse {
  job: ProductJobIntent | null;
  result: WorkerPersistProductJobResultRequest | null;
}

export interface WorkerPersistProductJobResultRequest {
  completedAt: string;
  exitCode: number | null;
  identityId: string;
  jobClass: ProductJobClass;
  jobName: string;
  logs: string;
  podName: string | null;
  status: Exclude<ProductJobStatus, 'queued' | 'running'>;
}

export interface WorkerFinalizeProductJobRequest {
  identityId: string;
  jobClass: ProductJobClass;
}

interface ProductJobSpecSchemaShape {
  command: z.ZodArray<z.ZodString>;
  env: z.ZodRecord<z.ZodString, z.ZodString>;
  image: z.ZodString;
  namespace: z.ZodString;
  timeoutMs: z.ZodNumber;
}

export const workerClaimProductJobPathname: string = '/internal/kube-jobs/claim-next';
export const workerPersistProductJobIntentPathname: string = '/internal/kube-jobs/intent';
export const workerPersistProductJobResultPathname: string = '/internal/kube-jobs/result';
export const workerFinalizeProductJobPathname: string = '/internal/kube-jobs/finalized';

const productJobSpecShape: ProductJobSpecSchemaShape = {
  command: z.array(z.string()),
  env: z.record(z.string(), z.string()),
  image: z.string().min(1),
  namespace: z.string().min(1),
  timeoutMs: z.number().int().positive(),
};

export const productJobIntentSchema: ContractSchema<ProductJobIntent> = z.discriminatedUnion('jobClass', [
  z.object({ ...productJobSpecShape, deploymentId: z.string().min(1), jobClass: z.literal('release') }).strict(),
  z
    .object({ ...productJobSpecShape, jobClass: z.literal('resource-operation'), operationId: z.string().min(1) })
    .strict(),
]);

export const workerClaimProductJobResponseSchema: ContractSchema<WorkerClaimProductJobResponse> = z
  .object({
    job: productJobIntentSchema.nullable(),
    result: z
      .lazy((): ContractSchema<WorkerPersistProductJobResultRequest> => workerPersistProductJobResultRequestSchema)
      .nullable(),
  })
  .strict();

export const workerPersistProductJobResultRequestSchema: ContractSchema<WorkerPersistProductJobResultRequest> = z
  .object({
    completedAt: z.string().datetime(),
    exitCode: z.number().int().nullable(),
    identityId: z.string().min(1),
    jobClass: z.enum(['release', 'resource-operation']),
    jobName: z.string().min(1),
    logs: z.string(),
    podName: z.string().min(1).nullable(),
    status: z.enum(['succeeded', 'failed', 'timed-out']),
  })
  .strict();

export const workerFinalizeProductJobRequestSchema: ContractSchema<WorkerFinalizeProductJobRequest> = z
  .object({ identityId: z.string().min(1), jobClass: z.enum(['release', 'resource-operation']) })
  .strict();
