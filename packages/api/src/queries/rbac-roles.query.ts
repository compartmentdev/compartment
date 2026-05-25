import type { PermissionKey } from '@compartment/contracts';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/client';
import { accessRolePermissions, accessRoles } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type {
  AccessRoleKindValue,
  AccessRoleRow,
  CreateAccessRoleInput,
  RbacTransaction,
  UpdateAccessRoleInput,
} from './rbac.query.types';

export async function createAccessRoleWithExecutor(
  executor: RbacTransaction,
  input: CreateAccessRoleInput,
): Promise<AccessRoleRow> {
  await executor.insert(accessRoles).values({
    description: input.description,
    id: input.id,
    kind: input.kind,
    name: input.name,
    organizationId: input.organizationId,
    updatedAt: input.updatedAt,
  });

  await replaceAccessRolePermissions(executor, input.id, input.permissionKeys);
  return requireAccessRole(await findAccessRoleByIdWithExecutor(executor, input.organizationId, input.id));
}

export async function findAccessRoleById(organizationId: string, roleId: string): Promise<AccessRoleRow | undefined> {
  return await findAccessRoleByIdWithExecutor(getApiDatabase(), organizationId, roleId);
}

export async function findAccessRoleByNameWithExecutor(
  executor: AccessRoleReader,
  organizationId: string,
  roleName: string,
): Promise<AccessRoleRow | undefined> {
  const rows: (typeof accessRoles.$inferSelect)[] = await executor
    .select()
    .from(accessRoles)
    .where(and(eq(accessRoles.organizationId, organizationId), eq(accessRoles.name, roleName)))
    .limit(1);
  const role: typeof accessRoles.$inferSelect | undefined = rows[0];
  if (role === undefined) {
    return undefined;
  }

  return await buildAccessRoleRow(executor, role);
}

export async function listAccessRolePermissionKeysWithExecutor(
  executor: AccessRoleReader,
  roleId: string,
): Promise<PermissionKey[]> {
  return (await listAccessRolePermissionKeysByRoleIds(executor, [roleId])).get(roleId) ?? [];
}

export async function findAccessRoleByIdWithExecutor(
  executor: AccessRoleReader,
  organizationId: string,
  roleId: string,
): Promise<AccessRoleRow | undefined> {
  const role: typeof accessRoles.$inferSelect | undefined = await findAccessRoleRecordByIdWithExecutor(
    executor,
    organizationId,
    roleId,
  );
  if (role === undefined) {
    return undefined;
  }

  return await buildAccessRoleRow(executor, role);
}

export async function listAccessRoles(organizationId: string): Promise<AccessRoleRow[]> {
  return await listAccessRolesWithExecutor(getApiDatabase(), organizationId);
}

async function listAccessRolesWithExecutor(
  executor: AccessRoleReader,
  organizationId: string,
): Promise<AccessRoleRow[]> {
  const roles: (typeof accessRoles.$inferSelect)[] = await listAccessRoleRecordsWithExecutor(executor, organizationId);
  const permissionKeysByRoleId: Map<string, PermissionKey[]> = await listAccessRolePermissionKeysByRoleIds(
    executor,
    roles.map((role: typeof accessRoles.$inferSelect): string => role.id),
  );

  return roles.map(
    (role: typeof accessRoles.$inferSelect): AccessRoleRow => ({
      createdAt: role.createdAt,
      description: role.description,
      id: role.id,
      kind: role.kind as AccessRoleKindValue,
      name: role.name,
      organizationId: role.organizationId,
      permissionKeys: permissionKeysByRoleId.get(role.id) ?? [],
      updatedAt: role.updatedAt,
    }),
  );
}

async function listAccessRoleRecordsWithExecutor(
  executor: AccessRoleReader,
  organizationId: string,
): Promise<(typeof accessRoles.$inferSelect)[]> {
  return await executor
    .select()
    .from(accessRoles)
    .where(eq(accessRoles.organizationId, organizationId))
    .orderBy(asc(accessRoles.kind), asc(accessRoles.name));
}

export async function updateAccessRoleWithExecutor(
  executor: RbacTransaction,
  input: UpdateAccessRoleInput,
): Promise<AccessRoleRow | undefined> {
  const [role]: (typeof accessRoles.$inferSelect)[] = await executor
    .update(accessRoles)
    .set({ description: input.description, updatedAt: input.updatedAt })
    .where(and(eq(accessRoles.organizationId, input.organizationId), eq(accessRoles.id, input.roleId)))
    .returning();
  if (role === undefined) {
    return undefined;
  }

  await replaceAccessRolePermissions(executor, input.roleId, input.permissionKeys);
  return await buildAccessRoleRow(executor, role);
}

export async function renameAccessRoleWithExecutor(
  executor: RbacTransaction,
  organizationId: string,
  roleId: string,
  roleName: string,
  description: string | null,
  updatedAt: Date,
): Promise<AccessRoleRow | undefined> {
  const [role]: (typeof accessRoles.$inferSelect)[] = await executor
    .update(accessRoles)
    .set({ description, name: roleName, updatedAt })
    .where(and(eq(accessRoles.organizationId, organizationId), eq(accessRoles.id, roleId)))
    .returning();
  if (role === undefined) {
    return undefined;
  }

  return await buildAccessRoleRow(executor, role);
}

export async function deleteAccessRoleWithExecutor(
  executor: RbacTransaction,
  organizationId: string,
  roleId: string,
): Promise<void> {
  await executor
    .delete(accessRoles)
    .where(and(eq(accessRoles.organizationId, organizationId), eq(accessRoles.id, roleId)));
}

function requireAccessRole(role: AccessRoleRow | undefined): AccessRoleRow {
  if (role === undefined) {
    throw new Error('Expected access role.');
  }

  return role;
}

async function findAccessRoleRecordByIdWithExecutor(
  executor: AccessRoleReader,
  organizationId: string,
  roleId: string,
): Promise<typeof accessRoles.$inferSelect | undefined> {
  const rows: (typeof accessRoles.$inferSelect)[] = await executor
    .select()
    .from(accessRoles)
    .where(and(eq(accessRoles.organizationId, organizationId), eq(accessRoles.id, roleId)))
    .limit(1);

  return rows[0];
}

async function buildAccessRoleRow(
  executor: AccessRoleReader,
  role: typeof accessRoles.$inferSelect,
): Promise<AccessRoleRow> {
  const permissionKeysByRoleId: Map<string, PermissionKey[]> = await listAccessRolePermissionKeysByRoleIds(executor, [
    role.id,
  ]);

  return toAccessRoleRow(role, permissionKeysByRoleId.get(role.id) ?? []);
}

function toAccessRoleRow(role: typeof accessRoles.$inferSelect, permissionKeys: PermissionKey[]): AccessRoleRow {
  return {
    createdAt: role.createdAt,
    description: role.description,
    id: role.id,
    kind: role.kind as AccessRoleKindValue,
    name: role.name,
    organizationId: role.organizationId,
    permissionKeys,
    updatedAt: role.updatedAt,
  };
}

async function listAccessRolePermissionKeysByRoleIds(
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

async function replaceAccessRolePermissions(
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

type AccessRoleReader = Database | RbacTransaction;
