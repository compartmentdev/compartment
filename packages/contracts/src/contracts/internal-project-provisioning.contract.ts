import { z } from 'zod';
import type { ContractSchema } from './schema.types';

interface ProjectProvisioningTargetBase {
  leaseId: string;
  namespaceId: string;
  projectId: string;
}

export interface ProjectProvisioningExecutionTarget extends ProjectProvisioningTargetBase {
  action: 'provision';
}

export interface ProjectProvisioningCleanupTarget extends ProjectProvisioningTargetBase {
  action: 'cleanup';
}

export type ProjectProvisioningTarget = ProjectProvisioningCleanupTarget | ProjectProvisioningExecutionTarget;

export interface WorkerClaimProjectProvisioningResponse {
  target: ProjectProvisioningTarget | null;
}

interface WorkerCompleteProjectProvisioningRequestBase {
  leaseId: string;
  message?: string | undefined;
  projectId: string;
  status: 'failed' | 'succeeded';
}

interface ProjectProvisioningCompletionSchemaShape extends z.ZodRawShape {
  leaseId: z.ZodString;
  message: z.ZodOptional<z.ZodString>;
  projectId: z.ZodString;
  status: z.ZodEnum<['failed', 'succeeded']>;
}

export interface WorkerCompleteProjectProvisioningExecutionRequest extends WorkerCompleteProjectProvisioningRequestBase {
  action: 'provision';
  cleanupRequired: boolean;
}

export interface WorkerCompleteProjectProvisioningCleanupRequest extends WorkerCompleteProjectProvisioningRequestBase {
  action: 'cleanup';
}

export type WorkerCompleteProjectProvisioningRequest =
  | WorkerCompleteProjectProvisioningCleanupRequest
  | WorkerCompleteProjectProvisioningExecutionRequest;

export interface WorkerCompleteProjectProvisioningResponse {
  applied: boolean;
}

export const workerClaimProjectProvisioningPathname: string = '/internal/kube-projects/claim-next';
export const workerCompleteProjectProvisioningPathname: string = '/internal/kube-projects/complete';

const projectProvisioningTargetSchema: ContractSchema<ProjectProvisioningTarget> = z
  .object({
    action: z.enum(['cleanup', 'provision']),
    leaseId: z.string().min(1),
    namespaceId: z.string().min(1),
    projectId: z.string().min(1),
  })
  .strict();

export const workerClaimProjectProvisioningResponseSchema: ContractSchema<WorkerClaimProjectProvisioningResponse> = z
  .object({ target: projectProvisioningTargetSchema.nullable() })
  .strict();

const projectProvisioningCompletionBase: ProjectProvisioningCompletionSchemaShape = {
  leaseId: z.string().min(1),
  message: z.string().min(1).optional(),
  projectId: z.string().min(1),
  status: z.enum(['failed', 'succeeded']),
};

export const workerCompleteProjectProvisioningRequestSchema: ContractSchema<WorkerCompleteProjectProvisioningRequest> =
  z
    .discriminatedUnion('action', [
      z.object({ ...projectProvisioningCompletionBase, action: z.literal('cleanup') }).strict(),
      z
        .object({
          ...projectProvisioningCompletionBase,
          action: z.literal('provision'),
          cleanupRequired: z.boolean(),
        })
        .strict(),
    ])
    .superRefine((input: WorkerCompleteProjectProvisioningRequest, context: z.RefinementCtx): void => {
      if (input.status === 'failed' && input.message === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'message is required for failed project provisioning',
          path: ['message'],
        });
      }
    }) as ContractSchema<WorkerCompleteProjectProvisioningRequest>;

export const workerCompleteProjectProvisioningResponseSchema: ContractSchema<WorkerCompleteProjectProvisioningResponse> =
  z.object({ applied: z.boolean() }).strict();
