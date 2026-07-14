import { z } from 'zod';
import type { ContractSchema } from './schema.types';

export interface ProjectProvisioningTarget {
  leaseId: string;
  namespaceId: string;
  projectId: string;
}

export interface WorkerClaimProjectProvisioningResponse {
  target: ProjectProvisioningTarget | null;
}

export interface WorkerCompleteProjectProvisioningRequest {
  leaseId: string;
  message?: string | undefined;
  projectId: string;
  status: 'failed' | 'succeeded';
}

export interface WorkerCompleteProjectProvisioningResponse {
  applied: boolean;
}

export const workerClaimProjectProvisioningPathname: string = '/internal/kube-projects/claim-next';
export const workerCompleteProjectProvisioningPathname: string = '/internal/kube-projects/complete';

const projectProvisioningTargetSchema: ContractSchema<ProjectProvisioningTarget> = z
  .object({
    leaseId: z.string().min(1),
    namespaceId: z.string().min(1),
    projectId: z.string().min(1),
  })
  .strict();

export const workerClaimProjectProvisioningResponseSchema: ContractSchema<WorkerClaimProjectProvisioningResponse> = z
  .object({ target: projectProvisioningTargetSchema.nullable() })
  .strict();

export const workerCompleteProjectProvisioningRequestSchema: ContractSchema<WorkerCompleteProjectProvisioningRequest> =
  z
    .object({
      leaseId: z.string().min(1),
      message: z.string().min(1).optional(),
      projectId: z.string().min(1),
      status: z.enum(['failed', 'succeeded']),
    })
    .strict()
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
