import {
  workerClaimOrganizationQuotaReconcilePathname,
  workerClaimOrganizationQuotaReconcileResponseSchema,
  workerCompleteOrganizationQuotaReconcilePathname,
  workerCompleteOrganizationQuotaReconcileRequestSchema,
  workerCompleteOrganizationQuotaReconcileResponseSchema,
  type WorkerClaimOrganizationQuotaReconcileResponse,
  type WorkerCompleteOrganizationQuotaReconcileRequest,
  type WorkerCompleteOrganizationQuotaReconcileResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function claimOrganizationQuotaReconcile(
  request: CompartmentRequester,
): Promise<WorkerClaimOrganizationQuotaReconcileResponse> {
  return await request<WorkerClaimOrganizationQuotaReconcileResponse, undefined>({
    method: 'POST',
    path: workerClaimOrganizationQuotaReconcilePathname,
    schema: workerClaimOrganizationQuotaReconcileResponseSchema,
  });
}

export async function completeOrganizationQuotaReconcile(
  request: CompartmentRequester,
  body: WorkerCompleteOrganizationQuotaReconcileRequest,
): Promise<WorkerCompleteOrganizationQuotaReconcileResponse> {
  workerCompleteOrganizationQuotaReconcileRequestSchema.parse(body);
  return await request<
    WorkerCompleteOrganizationQuotaReconcileResponse,
    WorkerCompleteOrganizationQuotaReconcileRequest
  >({
    body,
    method: 'POST',
    path: workerCompleteOrganizationQuotaReconcilePathname,
    schema: workerCompleteOrganizationQuotaReconcileResponseSchema,
  });
}
