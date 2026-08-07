import type {
  WorkerClaimOrganizationQuotaReconcileResponse,
  WorkerCompleteOrganizationQuotaReconcileResponse,
} from '@compartment/contracts';
import type { OrganizationQuotaReconciliationClaim } from '../../services/organization-quota-reconciliation.service.types';

export function buildWorkerClaimOrganizationQuotaReconcileResponse(
  target: OrganizationQuotaReconciliationClaim | null,
): WorkerClaimOrganizationQuotaReconcileResponse {
  return { target };
}

export function buildWorkerCompleteOrganizationQuotaReconcileResponse(
  applied: boolean,
): WorkerCompleteOrganizationQuotaReconcileResponse {
  return { applied };
}
