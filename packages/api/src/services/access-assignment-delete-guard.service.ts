import { createSelfAdminMembershipChangeForbiddenError } from '../errors/api-business-error';
import { hasAccessGroupPrincipalMembershipWithExecutor } from '../queries/rbac-groups.query';
import { listAccessRolePermissionKeysWithExecutor } from '../queries/rbac-role-permissions.query';
import type { AccessAssignmentRow, RbacTransaction } from '../queries/rbac.query.types';
import type { DeleteOrganizationAccessAssignmentInput } from './access-assignments.service.types';
import { hasOrganizationAdminPathPermissions } from './rbac-admin-path.service';

export async function assertSelfAdminAccessAssignmentDeletionAllowed(
  tx: RbacTransaction,
  input: DeleteOrganizationAccessAssignmentInput,
  assignment: AccessAssignmentRow,
): Promise<void> {
  if (await assignmentCoversPrincipal(tx, input.actorPrincipalId, assignment)) {
    throw createSelfAdminMembershipChangeForbiddenError();
  }
}

export async function isOrganizationAdminPathAssignment(
  tx: RbacTransaction,
  organizationId: string,
  assignment: AccessAssignmentRow,
): Promise<boolean> {
  if (assignment.scopeType !== 'organization' || assignment.scopeId !== organizationId) {
    return false;
  }

  return hasOrganizationAdminPathPermissions(await listAccessRolePermissionKeysWithExecutor(tx, assignment.roleId));
}

async function assignmentCoversPrincipal(
  tx: RbacTransaction,
  actorPrincipalId: string,
  assignment: AccessAssignmentRow,
): Promise<boolean> {
  if (assignment.subjectType === 'principal') {
    return assignment.subjectId === actorPrincipalId;
  }

  return await hasAccessGroupPrincipalMembershipWithExecutor(tx, {
    groupId: assignment.subjectId,
    organizationId: assignment.organizationId,
    principalId: actorPrincipalId,
  });
}
