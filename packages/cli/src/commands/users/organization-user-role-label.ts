import type { OrganizationUserListRow } from '@compartment/contracts';

export function readOrganizationUserRoleLabel(user: OrganizationUserListRow): string {
  return user.accessSummary.toLowerCase();
}
