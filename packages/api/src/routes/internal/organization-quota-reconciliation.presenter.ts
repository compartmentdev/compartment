import type {
  OrganizationQuotaReconcileTarget,
  WorkerClaimOrganizationQuotaReconcileResponse,
  WorkerCompleteOrganizationQuotaReconcileResponse,
} from '@compartment/contracts';

export function buildWorkerClaimOrganizationQuotaReconcileResponse(
  target: OrganizationQuotaReconcileTarget | null,
): WorkerClaimOrganizationQuotaReconcileResponse {
  return { target };
}

export function buildWorkerCompleteOrganizationQuotaReconcileResponse(
  applied: boolean,
): WorkerCompleteOrganizationQuotaReconcileResponse {
  return { applied };
}
