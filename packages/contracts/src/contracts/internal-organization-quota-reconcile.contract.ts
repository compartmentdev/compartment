import { z } from 'zod';
import type { ContractSchema } from './schema.types';

export interface OrganizationQuotaReconcileTarget {
  leaseId: string;
  namespaceIds: string[];
  organizationId: string;
}

export interface WorkerClaimOrganizationQuotaReconcileResponse {
  target: OrganizationQuotaReconcileTarget | null;
}

export interface WorkerCompleteOrganizationQuotaReconcileRequest {
  leaseId: string;
  message?: string | undefined;
  organizationId: string;
  status: 'failed' | 'succeeded';
}

export interface WorkerCompleteOrganizationQuotaReconcileResponse {
  applied: boolean;
}

export const workerClaimOrganizationQuotaReconcilePathname: string = '/internal/organization-quotas/claim-next';
export const workerCompleteOrganizationQuotaReconcilePathname: string = '/internal/organization-quotas/complete';

const organizationQuotaReconcileTargetSchema: ContractSchema<OrganizationQuotaReconcileTarget> = z
  .object({ leaseId: z.string().min(1), namespaceIds: z.array(z.string().min(1)), organizationId: z.string().min(1) })
  .strict();

export const workerClaimOrganizationQuotaReconcileResponseSchema: ContractSchema<WorkerClaimOrganizationQuotaReconcileResponse> =
  z.object({ target: organizationQuotaReconcileTargetSchema.nullable() }).strict();

export const workerCompleteOrganizationQuotaReconcileRequestSchema: ContractSchema<WorkerCompleteOrganizationQuotaReconcileRequest> =
  z
    .object({
      leaseId: z.string().min(1),
      message: z.string().min(1).optional(),
      organizationId: z.string().min(1),
      status: z.enum(['failed', 'succeeded']),
    })
    .strict()
    .superRefine((input: WorkerCompleteOrganizationQuotaReconcileRequest, context: z.RefinementCtx): void => {
      if (input.status === 'failed' && input.message === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'message is required for failed organization quota reconciliation',
          path: ['message'],
        });
      }
    }) as ContractSchema<WorkerCompleteOrganizationQuotaReconcileRequest>;

export const workerCompleteOrganizationQuotaReconcileResponseSchema: ContractSchema<WorkerCompleteOrganizationQuotaReconcileResponse> =
  z.object({ applied: z.boolean() }).strict();
