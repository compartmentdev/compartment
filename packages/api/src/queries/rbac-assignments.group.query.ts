import { and, eq } from 'drizzle-orm';
import { accessAssignments, accessRolePermissions } from '../db/schema';
import type { GroupAccessAssignmentPermissionGrantRow, RbacTransaction } from './rbac.query.types';

export async function listGroupAccessAssignmentPermissionGrantRowsWithExecutor(
  executor: RbacTransaction,
  organizationId: string,
  groupId: string,
): Promise<GroupAccessAssignmentPermissionGrantRow[]> {
  return (await executor
    .select({
      permissionKey: accessRolePermissions.permissionKey,
      roleId: accessAssignments.roleId,
      scopeId: accessAssignments.scopeId,
      scopeType: accessAssignments.scopeType,
    })
    .from(accessAssignments)
    .leftJoin(accessRolePermissions, eq(accessRolePermissions.roleId, accessAssignments.roleId))
    .where(
      and(
        eq(accessAssignments.organizationId, organizationId),
        eq(accessAssignments.subjectType, 'group'),
        eq(accessAssignments.subjectId, groupId),
      ),
    )) as GroupAccessAssignmentPermissionGrantRow[];
}
