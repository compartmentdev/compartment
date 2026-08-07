import { z } from 'zod';
import type { ContractSchema } from './schema.types';

export type ProjectProvisioningAction = 'provision' | 'teardown';

export interface ProjectProvisioningTargetV2 {
  action: ProjectProvisioningAction;
  isolationVersion: number;
  leaseId: string;
  namespaceId: string;
  organizationId: string;
  projectId: string;
  projectName: string;
}

export interface WorkerCompleteProjectProvisioningV2Request {
  action: ProjectProvisioningAction;
  isolationVersion: number;
  leaseId: string;
  message?: string | undefined;
  projectId: string;
  status: 'failed' | 'running' | 'succeeded';
}

export interface WorkerClaimProjectProvisioningV2Response {
  target: ProjectProvisioningTargetV2 | null;
}

export interface WorkerCompleteProjectProvisioningResponse {
  applied: boolean;
}

export const workerClaimProjectProvisioningV2Pathname: string = '/internal/kube-projects/v2/claim-next';
export const workerCompleteProjectProvisioningV2Pathname: string = '/internal/kube-projects/v2/complete';

const projectProvisioningTargetV2Schema: ContractSchema<ProjectProvisioningTargetV2> = z
  .object({
    action: z.enum(['provision', 'teardown']),
    isolationVersion: z.number().int().nonnegative(),
    leaseId: z.string().min(1),
    namespaceId: z.string().min(1),
    organizationId: z.string().min(1),
    projectId: z.string().min(1),
    projectName: z.string().min(1),
  })
  .strict();

export const workerClaimProjectProvisioningV2ResponseSchema: ContractSchema<WorkerClaimProjectProvisioningV2Response> =
  z.object({ target: projectProvisioningTargetV2Schema.nullable() }).strict();

export const workerCompleteProjectProvisioningV2RequestSchema: ContractSchema<WorkerCompleteProjectProvisioningV2Request> =
  z
    .object({
      action: z.enum(['provision', 'teardown']),
      isolationVersion: z.number().int().nonnegative(),
      leaseId: z.string().min(1),
      message: z.string().min(1).optional(),
      projectId: z.string().min(1),
      status: z.enum(['failed', 'running', 'succeeded']),
    })
    .strict()
    .superRefine((input: WorkerCompleteProjectProvisioningV2Request, context: z.RefinementCtx): void => {
      if (input.status === 'failed' && input.message === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'message is required for failed project provisioning',
          path: ['message'],
        });
      }
    }) as ContractSchema<WorkerCompleteProjectProvisioningV2Request>;

export const workerCompleteProjectProvisioningResponseSchema: ContractSchema<WorkerCompleteProjectProvisioningResponse> =
  z.object({ applied: z.boolean() }).strict();
