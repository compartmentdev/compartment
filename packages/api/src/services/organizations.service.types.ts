import type { OrganizationRow } from '../queries/organizations.query.types';

export type ResolvedOrganization = OrganizationRow;

export interface SessionVisibleOrganizationInput {
  id: string;
}
