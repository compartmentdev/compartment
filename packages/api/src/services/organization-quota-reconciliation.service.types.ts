export interface OrganizationQuotaReconciliationCompletionInput {
  failureMessage: string | null;
  leaseId: string;
  organizationId: string;
  status: 'failed' | 'succeeded';
}
