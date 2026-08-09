import { z } from 'zod';
import type { ContractSchema } from './schema.types';
import { tenantSecretEnvironmentSchema, type TenantSecretEnvironment } from './internal-tenant-secret.contract';

export type ProductJobClass = 'release' | 'resource-operation';
export type ProductJobRuntimeIdentity = 'project' | 'resource';
export type ProductJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'timed-out';

interface ProductJobSpec {
  command: string[];
  env: TenantSecretEnvironment;
  image: string;
  namespace: string;
  projectId: string;
  timeoutMs: number;
  volumeMounts?: ProductJobVolumeMount[] | undefined;
}

export interface ProductJobVolumeMount {
  claimName: string;
  expectedClaimUid: string;
  mountPath: string;
  name: string;
  readOnly?: boolean | undefined;
  resourceId: string;
  subPath?: string | undefined;
}

export interface ReleaseProductJobIntent extends ProductJobSpec {
  deploymentId: string;
  imagePullSecretId: string;
  jobClass: 'release';
}

export interface ResourceOperationProductJobIntent extends ProductJobSpec {
  jobClass: 'resource-operation';
  operationId: string;
  resourceIds: string[];
  runtimeIdentity: ProductJobRuntimeIdentity;
}

export type ProductJobIntent = ReleaseProductJobIntent | ResourceOperationProductJobIntent;

/**
 * Connected resource the claimed Job dials, with the instant its declared readiness budget runs out.
 * Resolved at claim time, so it reflects the resource rows as they exist now, not as they existed when
 * the Job was queued. Resources that declare no readiness are absent: there is no signal to consult.
 */
export interface ProductJobResourceReadiness {
  deadlineAt: string;
  resourceId: string;
}

export interface WorkerClaimProductJobResponse {
  job: ProductJobIntent | null;
  resourceReadiness: ProductJobResourceReadiness[];
  result: WorkerPersistProductJobResultRequest | null;
}

export interface WorkerClaimProductJobRequest {
  jobClass: ProductJobClass;
}

export interface WorkerPersistProductJobIntentResponse {
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

/**
 * Reports that the worker is handing this Job's manifest to the API server. It states what the control plane told
 * the cluster, never that the Job is running: the Pod may still be pending, already finished, or never admitted.
 */
export interface WorkerSubmitProductJobRequest {
  identityId: string;
  jobClass: ProductJobClass;
}

interface ProductJobSpecSchemaShape {
  command: z.ZodArray<z.ZodString>;
  env: typeof tenantSecretEnvironmentSchema;
  image: z.ZodString;
  namespace: z.ZodString;
  projectId: z.ZodString;
  timeoutMs: z.ZodNumber;
  volumeMounts: z.ZodOptional<ContractSchema<ProductJobVolumeMount[]>>;
}

export const workerClaimProductJobPathname: string = '/internal/kube-jobs/claim-next';
export const workerPersistProductJobIntentPathname: string = '/internal/kube-jobs/intent';
export const workerPersistProductJobResultPathname: string = '/internal/kube-jobs/result';
export const workerFinalizeProductJobPathname: string = '/internal/kube-jobs/finalized';
export const workerSubmitProductJobPathname: string = '/internal/kube-jobs/submitted';

export function productJobRuntimeId(jobClass: ProductJobClass, identityId: string): string {
  return `${jobClass}-${identityId}`;
}

const productJobSpecShape: ProductJobSpecSchemaShape = {
  command: z.array(z.string()),
  env: tenantSecretEnvironmentSchema,
  image: z.string().min(1),
  namespace: z.string().min(1),
  projectId: z.string().min(1),
  timeoutMs: z.number().int().positive(),
  volumeMounts: z
    .array(
      z
        .object({
          claimName: z.string().min(1),
          expectedClaimUid: z.string().min(1),
          mountPath: z.string().startsWith('/'),
          name: z.string().min(1),
          readOnly: z.boolean().optional(),
          resourceId: z.string().min(1),
          subPath: z.string().min(1).optional(),
        })
        .strict(),
    )
    .optional(),
};

export const productJobIntentSchema: ContractSchema<ProductJobIntent> = z.discriminatedUnion('jobClass', [
  z
    .object({
      ...productJobSpecShape,
      deploymentId: z.string().min(1),
      imagePullSecretId: z.string().min(1),
      jobClass: z.literal('release'),
    })
    .strict(),
  z
    .object({
      ...productJobSpecShape,
      jobClass: z.literal('resource-operation'),
      operationId: z.string().min(1),
      resourceIds: z.array(z.string().min(1)).min(1),
      runtimeIdentity: z.enum(['project', 'resource']),
    })
    .strict(),
]);

const productJobResourceReadinessSchema: ContractSchema<ProductJobResourceReadiness> = z
  .object({ deadlineAt: z.string().datetime(), resourceId: z.string().min(1) })
  .strict();

export const workerClaimProductJobResponseSchema: ContractSchema<WorkerClaimProductJobResponse> = z
  .object({
    job: productJobIntentSchema.nullable(),
    resourceReadiness: z.array(productJobResourceReadinessSchema),
    result: z
      .lazy((): ContractSchema<WorkerPersistProductJobResultRequest> => workerPersistProductJobResultRequestSchema)
      .nullable(),
  })
  .strict();

export const workerClaimProductJobRequestSchema: ContractSchema<WorkerClaimProductJobRequest> = z
  .object({ jobClass: z.enum(['release', 'resource-operation']) })
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

export const workerPersistProductJobIntentResponseSchema: ContractSchema<WorkerPersistProductJobIntentResponse> = z
  .object({ result: workerPersistProductJobResultRequestSchema.nullable() })
  .strict();

export const workerFinalizeProductJobRequestSchema: ContractSchema<WorkerFinalizeProductJobRequest> = z
  .object({ identityId: z.string().min(1), jobClass: z.enum(['release', 'resource-operation']) })
  .strict();

export const workerSubmitProductJobRequestSchema: ContractSchema<WorkerSubmitProductJobRequest> = z
  .object({ identityId: z.string().min(1), jobClass: z.enum(['release', 'resource-operation']) })
  .strict();
