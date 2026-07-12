import { z } from 'zod';
import type { ContractSchema } from './schema.types';

export type DeploymentReconcileState = 'desired' | 'pending' | 'active';
export type DeploymentReconcileObservation = 'pending' | 'ready' | 'failed';

export interface DeploymentReconcileProjection {
  containerPort: number;
  deploymentId: string;
  environmentId: string;
  environmentName: string;
  env: Record<string, string>;
  image: string;
  namespaceId: string;
  organizationId: string;
  organizationName: string;
  projectId: string;
  projectName: string;
  releaseCommand: string | null;
  replicas: number;
  secretId: string;
  serviceId: string;
  serviceName: string;
  terminationGracePeriodSeconds: number;
}

export interface DeploymentReconcileTarget {
  active: DeploymentReconcileProjection | null;
  candidate: DeploymentReconcileProjection;
  revision: number;
  rolloutStartedAt: string;
  state: DeploymentReconcileState;
}

export interface WorkerClaimDeploymentReconcileResponse {
  target: DeploymentReconcileTarget | null;
}

export interface WorkerObserveDeploymentReconcileRequest {
  deploymentId: string;
  message?: string | undefined;
  observation: DeploymentReconcileObservation;
  observedAt: string;
  revision: number;
}

export interface WorkerObserveDeploymentReconcileResponse {
  applied: boolean;
}

export interface WorkerPrepareDeploymentReconcileRequest {
  deploymentId: string;
  deploymentName: string;
  imageRef: string;
  namespace: string;
  networkPolicyNames: string[];
  routeHost: string;
  serviceName: string;
}

export interface WorkerPrepareDeploymentReconcileResponse {
  prepared: boolean;
}

export const workerClaimDeploymentReconcilePathname: string = '/internal/kube-deployments/claim-next';
export const workerObserveDeploymentReconcilePathname: string = '/internal/kube-deployments/observation';
export const workerPrepareDeploymentReconcilePathname: string = '/internal/kube-deployments/desired';

const deploymentReconcileProjectionSchema: ContractSchema<DeploymentReconcileProjection> = z
  .object({
    containerPort: z.number().int().positive(),
    deploymentId: z.string().min(1),
    environmentId: z.string().min(1),
    environmentName: z.string().min(1),
    env: z.record(z.string(), z.string()),
    image: z.string().min(1),
    namespaceId: z.string().min(1),
    organizationId: z.string().min(1),
    organizationName: z.string().min(1),
    projectId: z.string().min(1),
    projectName: z.string().min(1),
    releaseCommand: z.string().min(1).nullable(),
    replicas: z.number().int().positive(),
    secretId: z.string().min(1),
    serviceId: z.string().min(1),
    serviceName: z.string().min(1),
    terminationGracePeriodSeconds: z.number().int().min(45),
  })
  .strict();

const deploymentReconcileTargetSchema: ContractSchema<DeploymentReconcileTarget> = z
  .object({
    active: deploymentReconcileProjectionSchema.nullable(),
    candidate: deploymentReconcileProjectionSchema,
    revision: z.number().int().nonnegative(),
    rolloutStartedAt: z.string().datetime(),
    state: z.enum(['desired', 'pending', 'active']),
  })
  .strict();

export const workerClaimDeploymentReconcileResponseSchema: ContractSchema<WorkerClaimDeploymentReconcileResponse> = z
  .object({ target: deploymentReconcileTargetSchema.nullable() })
  .strict();

export const workerObserveDeploymentReconcileRequestSchema: ContractSchema<WorkerObserveDeploymentReconcileRequest> = z
  .object({
    deploymentId: z.string().min(1),
    message: z.string().min(1).optional(),
    observation: z.enum(['pending', 'ready', 'failed']),
    observedAt: z.string().datetime(),
    revision: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((input: WorkerObserveDeploymentReconcileRequest, context: z.RefinementCtx): void => {
    if (input.observation === 'failed' && input.message === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'message is required for failed observations',
        path: ['message'],
      });
    }
  }) as ContractSchema<WorkerObserveDeploymentReconcileRequest>;

export const workerObserveDeploymentReconcileResponseSchema: ContractSchema<WorkerObserveDeploymentReconcileResponse> =
  z.object({ applied: z.boolean() }).strict();

export const workerPrepareDeploymentReconcileRequestSchema: ContractSchema<WorkerPrepareDeploymentReconcileRequest> = z
  .object({
    deploymentId: z.string().min(1),
    deploymentName: z.string().min(1),
    imageRef: z.string().min(1),
    namespace: z.string().min(1),
    networkPolicyNames: z.array(z.string().min(1)),
    routeHost: z.string().min(1),
    serviceName: z.string().min(1),
  })
  .strict();

export const workerPrepareDeploymentReconcileResponseSchema: ContractSchema<WorkerPrepareDeploymentReconcileResponse> =
  z.object({ prepared: z.boolean() }).strict();
