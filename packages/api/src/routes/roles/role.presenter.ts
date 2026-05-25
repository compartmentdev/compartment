import type { AccessRoleResponse, AccessRoleSummary } from '@compartment/contracts';

export function buildAccessRoleResponse(role: AccessRoleSummary): AccessRoleResponse {
  return { role };
}
