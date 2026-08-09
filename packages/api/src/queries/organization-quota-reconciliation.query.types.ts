import type { OrganizationQuotaReconcileTarget } from '@compartment/contracts';
import type { ApiDatabaseTransaction } from '../db/client.types';

export type OrganizationQuotaReconcileClaimRow = OrganizationQuotaReconcileTarget;
export type OrganizationQuotaTransaction = ApiDatabaseTransaction;

export interface CompleteOrganizationQuotaReconcileInput {
  failureMessage: string | null;
  leaseId: string;
  organizationId: string;
  status: 'failed' | 'succeeded';
}
