import type { PermissionKey } from '@compartment/contracts';
import { listGroupAccessAssignmentPermissionGrantRowsWithExecutor } from '../queries/rbac-assignments.query';
import type { GroupAccessAssignmentPermissionGrantRow, RbacTransaction } from '../queries/rbac.query.types';
import type { AddOrganizationAccessGroupMemberInput } from './access-groups.service.types';
import type { RbacGrantablePermissionSet, RbacGrantablePermissionsScope } from './rbac-admin-invariant.service.types';
import { assertPrincipalCanGrantPermissionSetsWithExecutor } from './rbac-grantability.service';

export async function assertActorCanGrantGroupAssignments(
  tx: RbacTransaction,
  input: Pick<AddOrganizationAccessGroupMemberInput, 'actorPrincipalId' | 'groupId' | 'organizationId'>,
): Promise<void> {
  const assignmentPermissionRows: GroupAccessAssignmentPermissionGrantRow[] =
    await listGroupAccessAssignmentPermissionGrantRowsWithExecutor(tx, input.organizationId, input.groupId);
  await assertPrincipalCanGrantPermissionSetsWithExecutor(tx, {
    actorPrincipalId: input.actorPrincipalId,
    organizationId: input.organizationId,
    permissionSets: buildGrantablePermissionSets(assignmentPermissionRows),
  });
}

function buildGrantablePermissionSets(
  rows: readonly GroupAccessAssignmentPermissionGrantRow[],
): RbacGrantablePermissionSet[] {
  const permissionKeysByScope: Map<string, Set<PermissionKey>> = new Map<string, Set<PermissionKey>>();
  const scopesByKey: Map<string, RbacGrantablePermissionsScope> = new Map<string, RbacGrantablePermissionsScope>();
  for (const row of rows) {
    if (row.permissionKey === null) {
      continue;
    }

    const scopeKey: string = buildPermissionScopeKey(row);
    scopesByKey.set(scopeKey, toGrantablePermissionScope(row));
    const permissionKeys: Set<PermissionKey> = permissionKeysByScope.get(scopeKey) ?? new Set<PermissionKey>();
    permissionKeys.add(row.permissionKey);
    permissionKeysByScope.set(scopeKey, permissionKeys);
  }

  return [...permissionKeysByScope.entries()].map(
    ([scopeKey, permissionKeys]: [string, Set<PermissionKey>]): RbacGrantablePermissionSet =>
      toGrantablePermissionSet(requireGrantablePermissionScope(scopesByKey.get(scopeKey)), permissionKeys),
  );
}

function toGrantablePermissionSet(
  scope: RbacGrantablePermissionsScope,
  permissionKeys: Set<PermissionKey>,
): RbacGrantablePermissionSet {
  return { permissionKeys: [...permissionKeys], scope };
}

function toGrantablePermissionScope(row: GroupAccessAssignmentPermissionGrantRow): RbacGrantablePermissionsScope {
  return { scopeId: row.scopeId, scopeType: row.scopeType };
}

function buildPermissionScopeKey(row: GroupAccessAssignmentPermissionGrantRow): string {
  return `${row.scopeType}:${row.scopeId}`;
}

function requireGrantablePermissionScope(
  scope: RbacGrantablePermissionsScope | undefined,
): RbacGrantablePermissionsScope {
  if (scope === undefined) {
    throw new Error('Expected grantable permission scope.');
  }

  return scope;
}
