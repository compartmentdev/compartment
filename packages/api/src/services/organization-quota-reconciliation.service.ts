import type { OrganizationQuotaReconcileTarget } from '@compartment/contracts';
import {
  claimOrganizationQuotaReconciliation,
  completeOrganizationQuotaReconciliation,
} from '../queries/organization-quota-reconciliation.query';
import type { OrganizationQuotaReconciliationCompletionInput } from './organization-quota-reconciliation.service.types';

export async function claimNextOrganizationQuotaReconciliation(): Promise<OrganizationQuotaReconcileTarget | null> {
  return await claimOrganizationQuotaReconciliation();
}

export async function acknowledgeOrganizationQuotaReconciliation(
  input: OrganizationQuotaReconciliationCompletionInput,
): Promise<boolean> {
  return await completeOrganizationQuotaReconciliation({
    failureMessage: input.failureMessage,
    leaseId: input.leaseId,
    organizationId: input.organizationId,
    status: input.status,
  });
}
