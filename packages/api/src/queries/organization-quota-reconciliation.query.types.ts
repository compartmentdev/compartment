import type { ApiDatabaseTransaction } from '../db/client.types';

export interface OrganizationQuotaReconcileClaimRow {
  leaseId: string;
  organizationId: string;
}
export type OrganizationQuotaTransaction = ApiDatabaseTransaction;

export interface CompleteOrganizationQuotaReconcileInput {
  failureMessage: string | null;
  leaseId: string;
  organizationId: string;
  status: 'failed' | 'succeeded';
}

export interface OrganizationQuotaInfrastructureBlockerRow {
  message: string;
  retryAt: Date;
}
