import type { OperationRecord } from '../queries/operations.query.types';
import type { OrganizationRow } from '../queries/organizations.query.types';

export interface CreateOrganizationInput {
  name: string;
  principalId: string;
  slug?: string | undefined;
}

export interface CreateOrganizationResult {
  operation: OperationRecord;
  organization: OrganizationRow;
}
