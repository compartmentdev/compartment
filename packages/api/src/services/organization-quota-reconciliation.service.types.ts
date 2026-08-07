export interface OrganizationQuotaReconciliationClaim {
  leaseId: string;
  organizationId: string;
}

export interface OrganizationQuotaReconciliationCompletionInput {
  failureMessage: string | null;
  leaseId: string;
  organizationId: string;
  status: 'failed' | 'succeeded';
}
