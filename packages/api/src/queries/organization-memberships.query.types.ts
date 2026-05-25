import type { PermissionKey } from '@compartment/contracts';

export interface OrganizationAdminPermissionGrantRow {
  permissionKey: PermissionKey;
  principalId: string;
}

export interface OrganizationMembershipOrganizationRow {
  id: string;
  name: string;
  slug: string;
}
