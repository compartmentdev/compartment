import type { PermissionKey } from '@compartment/contracts';
import { createUserNotFoundError } from '../errors/api-business-error';
import { findOrganizationUserByEmail } from '../queries/organization-users.query';
import type { OrganizationUserRow } from '../queries/organization-users.query.types';
import {
  listAccessAssignmentSummaries,
  listDirectAccessAssignmentSummariesForPrincipal,
  listDirectPrincipalPermissionGrantRows,
  listGroupPrincipalPermissionGrantRows,
} from '../queries/rbac-assignments.query';
import { listPrincipalGroups } from '../queries/rbac-groups.query';
import { listEffectivePermissions, toAccessAssignmentResults } from './access-assignments.service.helpers';
import { toAccessGroupResult } from './access-groups.service.helpers';
import type { AccessGroupResult } from './access-groups.service.types';
import { toOrganizationUserResult } from './organization-users.service.helpers';
import type { AccessAssignmentResult, UserAccessDetailResult } from './access-assignments.service.types';

export { createOrganizationAccessAssignment } from './access-assignments-create.service';

export async function listOrganizationAccessAssignments(organizationId: string): Promise<AccessAssignmentResult[]> {
  return await toAccessAssignmentResults(await listAccessAssignmentSummaries(organizationId));
}

export async function readOrganizationUserAccessDetail(
  organizationId: string,
  email: string,
): Promise<UserAccessDetailResult> {
  const user: OrganizationUserRow | undefined = await findOrganizationUserByEmail(organizationId, email);
  if (user === undefined) {
    throw createUserNotFoundError();
  }

  const groups: AccessGroupResult[] = await readPrincipalGroupResults(organizationId, user.id);
  const directAssignments: AccessAssignmentResult[] = await readDirectAccessAssignments(organizationId, user.id);
  const effectivePermissions: PermissionKey[] = await readEffectivePermissionsForPrincipal(organizationId, user.id);

  return {
    directAssignments,
    effectivePermissions,
    groups,
    user: toOrganizationUserResult(user),
  };
}

async function readPrincipalGroupResults(organizationId: string, principalId: string): Promise<AccessGroupResult[]> {
  return (await listPrincipalGroups(organizationId, principalId)).map(toAccessGroupResult);
}

async function readDirectAccessAssignments(
  organizationId: string,
  principalId: string,
): Promise<AccessAssignmentResult[]> {
  return await toAccessAssignmentResults(
    await listDirectAccessAssignmentSummariesForPrincipal(organizationId, principalId),
  );
}

async function readEffectivePermissionsForPrincipal(
  organizationId: string,
  principalId: string,
): Promise<PermissionKey[]> {
  const directPermissionGrants: { permissionKey: PermissionKey }[] = await listDirectPrincipalPermissionGrantRows(
    organizationId,
    principalId,
  );
  const groupPermissionGrants: { permissionKey: PermissionKey }[] = await listGroupPrincipalPermissionGrantRows(
    organizationId,
    principalId,
  );

  return listEffectivePermissions(
    [...directPermissionGrants, ...groupPermissionGrants].map(
      (grant: { permissionKey: PermissionKey }): PermissionKey => grant.permissionKey,
    ),
  );
}
