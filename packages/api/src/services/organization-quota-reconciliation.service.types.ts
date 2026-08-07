export interface OrganizationQuotaReconciliationClaim {
  leaseId: string;
  namespaceIds: string[];
  organizationId: string;
}

export interface OrganizationQuotaReconciliationCompletionInput {
  failureMessage: string | null;
  leaseId: string;
  organizationId: string;
  status: 'failed' | 'succeeded';
}
