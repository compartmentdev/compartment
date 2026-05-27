import type { ListPagination, PermissionKey } from '@compartment/contracts';
import { and, asc, eq } from 'drizzle-orm';
import { accessRoles } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import { buildListPagination } from './list-pagination.query';
import { countAccessRoleRecords, listAccessRolePageRecords } from './rbac-roles-list.query';
import {
  listAccessRolePermissionKeysByRoleIds,
  replaceAccessRolePermissions,
  type AccessRoleReader,
} from './rbac-role-permissions.query';
import type {
  AccessRolesPageResult,
  AccessRoleListPageRecord,
  ListAccessRolesPageInput,
} from './rbac-roles-list.query.types';
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

export async function listAccessRolesPage(input: ListAccessRolesPageInput): Promise<AccessRolesPageResult> {
  const pagination: ListPagination = await readAccessRolePagePagination(input);
  const records: AccessRoleListPageRecord[] = await listAccessRolePageRecords({ ...input, page: pagination.page });
  const permissionKeysByRoleId: Map<string, PermissionKey[]> = await listAccessRolePermissionKeysByRoleIds(
    getApiDatabase(),
    records.map((record: AccessRoleListPageRecord): string => record.id),
  );
  const result: AccessRolesPageResult = { pagination, roles: [] };
  for (const record of records) {
    result.roles.push({
      assignmentCount: record.assignmentCount,
      description: record.description,
      groupCount: record.groupCount,
      id: record.id,
      kind: record.kind,
      name: record.name,
      permissionKeys: permissionKeysByRoleId.get(record.id) ?? [],
      principalCount: record.principalCount,
    });
  }

  return result;
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

async function readAccessRolePagePagination(input: ListAccessRolesPageInput): Promise<ListPagination> {
  const totalItems: number = await countAccessRoleRecords(input.organizationId, input.search);

  return buildListPagination({
    page: input.page,
    perPage: input.perPage,
    totalItems,
  });
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
