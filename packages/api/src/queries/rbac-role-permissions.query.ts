import type { PermissionKey } from '@compartment/contracts';
import { eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/client';
import { accessRolePermissions } from '../db/schema';
import type { RbacTransaction } from './rbac.query.types';

export type AccessRoleReader = Database | RbacTransaction;

export async function listAccessRolePermissionKeysWithExecutor(
  executor: AccessRoleReader,
  roleId: string,
): Promise<PermissionKey[]> {
  return (await listAccessRolePermissionKeysByRoleIds(executor, [roleId])).get(roleId) ?? [];
}

export async function listAccessRolePermissionKeysByRoleIds(
  executor: AccessRoleReader,
  roleIds: readonly string[],
): Promise<Map<string, PermissionKey[]>> {
  const permissionKeysByRoleId: Map<string, PermissionKey[]> = new Map<string, PermissionKey[]>();
  if (roleIds.length === 0) {
    return permissionKeysByRoleId;
  }

  const rows: (typeof accessRolePermissions.$inferSelect)[] = await executor
    .select()
    .from(accessRolePermissions)
    .where(inArray(accessRolePermissions.roleId, [...roleIds]));
  for (const row of rows) {
    const existing: PermissionKey[] = permissionKeysByRoleId.get(row.roleId) ?? [];
    permissionKeysByRoleId.set(row.roleId, [...existing, row.permissionKey as PermissionKey]);
  }

  return permissionKeysByRoleId;
}

export async function replaceAccessRolePermissions(
  executor: RbacTransaction,
  roleId: string,
  permissionKeys: readonly PermissionKey[],
): Promise<void> {
  await executor.delete(accessRolePermissions).where(eq(accessRolePermissions.roleId, roleId));
  if (permissionKeys.length === 0) {
    return;
  }

  await executor.insert(accessRolePermissions).values(
    permissionKeys.map((permissionKey: PermissionKey): typeof accessRolePermissions.$inferInsert => ({
      id: `${roleId}:${permissionKey}`,
      permissionKey,
      roleId,
    })),
  );
}
