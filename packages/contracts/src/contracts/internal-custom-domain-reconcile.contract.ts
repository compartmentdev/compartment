import { z } from 'zod';
import type { ContractSchema } from './schema.types';

export type CustomDomainReconcileOperation = 'reconcile' | 'delete';

export interface CustomDomainReconcileTarget {
  desiredGeneration: number;
  domainId: string;
  host: string;
  operation: CustomDomainReconcileOperation;
}

export interface WorkerClaimCustomDomainReconcileResponse {
  leaseId: string | null;
  target: CustomDomainReconcileTarget | null;
}

export interface WorkerObserveCustomDomainReconcileRequest {
  certificatePresent: boolean;
  certificateReady: boolean;
  ingressPresent: boolean;
  leaseId: string;
  observedGeneration: number;
  releaseLease: boolean;
}

export interface WorkerCompleteCustomDomainReconcileRequest {
  leaseId: string;
  observedGeneration: number;
}

export interface WorkerFailCustomDomainReconcileRequest {
  failureMessage: string;
  leaseId: string;
  observedGeneration: number;
}

export interface WorkerCustomDomainReconcileMutationResponse {
  applied: boolean;
}

export const workerClaimCustomDomainReconcilePathname: string = '/internal/kube-custom-domains/claim-next';
export const workerObserveCustomDomainReconcilePathname: string = '/internal/kube-custom-domains/observation';
export const workerCompleteCustomDomainReconcilePathname: string = '/internal/kube-custom-domains/complete';
export const workerFailCustomDomainReconcilePathname: string = '/internal/kube-custom-domains/failure';

const customDomainReconcileTargetSchema: ContractSchema<CustomDomainReconcileTarget> = z
  .object({
    desiredGeneration: z.number().int().positive(),
    domainId: z.string().min(1),
    host: z.string().min(1),
    operation: z.enum(['reconcile', 'delete']),
  })
  .strict();

export const workerClaimCustomDomainReconcileResponseSchema: ContractSchema<WorkerClaimCustomDomainReconcileResponse> =
  z
    .object({
      leaseId: z.string().min(1).nullable(),
      target: customDomainReconcileTargetSchema.nullable(),
    })
    .strict()
    .superRefine((input: WorkerClaimCustomDomainReconcileResponse, context: z.RefinementCtx): void => {
      if ((input.leaseId === null) !== (input.target === null)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'leaseId and target must both be null or present' });
      }
    }) as ContractSchema<WorkerClaimCustomDomainReconcileResponse>;

export const workerObserveCustomDomainReconcileRequestSchema: ContractSchema<WorkerObserveCustomDomainReconcileRequest> =
  z
    .object({
      certificatePresent: z.boolean(),
      certificateReady: z.boolean(),
      ingressPresent: z.boolean(),
      leaseId: z.string().min(1),
      observedGeneration: z.number().int().positive(),
      releaseLease: z.boolean(),
    })
    .strict()
    .superRefine((input: WorkerObserveCustomDomainReconcileRequest, context: z.RefinementCtx): void => {
      if (input.certificateReady && !input.certificatePresent) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'certificatePresent is required when certificateReady is true',
          path: ['certificatePresent'],
        });
      }
    }) as ContractSchema<WorkerObserveCustomDomainReconcileRequest>;

export const workerCompleteCustomDomainReconcileRequestSchema: ContractSchema<WorkerCompleteCustomDomainReconcileRequest> =
  z.object({ leaseId: z.string().min(1), observedGeneration: z.number().int().positive() }).strict();

export const workerFailCustomDomainReconcileRequestSchema: ContractSchema<WorkerFailCustomDomainReconcileRequest> = z
  .object({
    failureMessage: z.string().min(1),
    leaseId: z.string().min(1),
    observedGeneration: z.number().int().positive(),
  })
  .strict();

export const workerCustomDomainReconcileMutationResponseSchema: ContractSchema<WorkerCustomDomainReconcileMutationResponse> =
  z.object({ applied: z.boolean() }).strict();
