import {
  claimOrganizationQuotaReconciliation,
  completeOrganizationQuotaReconciliation,
} from '../queries/organization-quota-reconciliation.query';
import type { OrganizationQuotaReconcileClaimRow } from '../queries/organization-quota-reconciliation.query.types';
import type {
  OrganizationQuotaReconciliationClaim,
  OrganizationQuotaReconciliationCompletionInput,
} from './organization-quota-reconciliation.service.types';

export async function claimNextOrganizationQuotaReconciliation(): Promise<OrganizationQuotaReconciliationClaim | null> {
  const claim: OrganizationQuotaReconcileClaimRow | null = await claimOrganizationQuotaReconciliation();
  return claim === null
    ? null
    : {
        leaseId: claim.leaseId,
        namespaceIds: claim.namespaceIds,
        organizationId: claim.organizationId,
      };
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
