import type {
  AccessRoleListRow,
  AccessRoleSummary,
  CreateAccessRoleRequest,
  UpdateAccessRoleRequest,
} from '@compartment/contracts';
import { createId } from '../lib/tokens';
import {
  createAccessRoleImmutableError,
  createAccessRoleNameTakenError,
  createAccessRoleNotFoundError,
} from '../errors/api-business-error';
import {
  createAccessRoleWithExecutor,
  deleteAccessRoleWithExecutor,
  findAccessRoleById,
  findAccessRoleByIdWithExecutor,
  findAccessRoleByNameWithExecutor,
  listAccessRoles,
  renameAccessRoleWithExecutor,
  updateAccessRoleWithExecutor,
} from '../queries/rbac-roles.query';
import { listAccessAssignmentSummaries } from '../queries/rbac-assignments.query';
import type { AccessAssignmentSummaryRow, AccessRoleRow, RbacTransaction } from '../queries/rbac.query.types';
import { normalizeDescription } from './access-description.service.helpers';
import { assertCanGrantOrganizationRolePermissions } from './access-roles-grantability.service';
import { buildRoleUsageByRoleId, type RoleUsageSummary } from './access-roles.service.helpers';
import { runOrganizationAccessMutationTransaction } from './rbac-admin-invariant.service';
import type {
  CreateOrganizationAccessRoleInput,
  DeleteOrganizationAccessRoleInput,
  UpdateOrganizationAccessRoleInput,
} from './access-roles.service.types';

export async function listOrganizationAccessRoles(organizationId: string): Promise<AccessRoleListRow[]> {
  const [roles, assignments]: [AccessRoleRow[], AccessAssignmentSummaryRow[]] = await Promise.all([
    listAccessRoles(organizationId),
    listAccessAssignmentSummaries(organizationId),
  ]);
  const usageByRoleId: ReadonlyMap<string, RoleUsageSummary> = buildRoleUsageByRoleId(assignments);

  return roles.map((role: AccessRoleRow): AccessRoleListRow => toAccessRoleListRow(role, usageByRoleId.get(role.id)));
}

export async function readOrganizationAccessRole(organizationId: string, roleId: string): Promise<AccessRoleSummary> {
  return toAccessRoleSummary(await requireAccessRole(organizationId, roleId));
}

export async function createOrganizationAccessRole(
  input: CreateOrganizationAccessRoleInput,
): Promise<AccessRoleSummary> {
  return await runOrganizationAccessMutationTransaction({
    organizationId: input.organizationId,
    mutation: async (tx: RbacTransaction): Promise<AccessRoleSummary> => {
      await assertCanGrantOrganizationRolePermissions(tx, input, input.request.permissionKeys);
      return await createAccessRoleInTransaction(tx, input);
    },
  });
}

export async function updateOrganizationAccessRole(
  input: UpdateOrganizationAccessRoleInput,
): Promise<AccessRoleSummary> {
  return await runOrganizationAccessMutationTransaction({
    organizationId: input.organizationId,
    mutation: async (tx: RbacTransaction): Promise<AccessRoleSummary> => {
      if (input.request.permissionKeys !== undefined) {
        await assertCanGrantOrganizationRolePermissions(tx, input, input.request.permissionKeys);
      }
      return await updateAccessRoleInTransaction(tx, input);
    },
  });
}

export async function deleteOrganizationAccessRole(input: DeleteOrganizationAccessRoleInput): Promise<void> {
  await runOrganizationAccessMutationTransaction({
    organizationId: input.organizationId,
    mutation: async (tx: RbacTransaction): Promise<void> => {
      await requireMutableAccessRoleWithExecutor(tx, input.organizationId, input.roleId);
      await deleteAccessRoleWithExecutor(tx, input.organizationId, input.roleId);
    },
  });
}

async function createAccessRoleInTransaction(
  tx: RbacTransaction,
  input: CreateOrganizationAccessRoleInput,
): Promise<AccessRoleSummary> {
  const request: CreateAccessRoleRequest = input.request;
  await assertAccessRoleNameAvailable(tx, input.organizationId, request.name);
  const role: AccessRoleRow = await createAccessRoleWithExecutor(tx, {
    id: createId('rol'),
    kind: 'custom',
    description: normalizeDescription(request.description),
    name: request.name,
    organizationId: input.organizationId,
    permissionKeys: request.permissionKeys,
    updatedAt: new Date(),
  });

  return toAccessRoleSummary(role);
}

async function updateAccessRoleInTransaction(
  tx: RbacTransaction,
  input: UpdateOrganizationAccessRoleInput,
): Promise<AccessRoleSummary> {
  const role: AccessRoleRow = await requireMutableAccessRoleWithExecutor(tx, input.organizationId, input.roleId);
  const request: UpdateAccessRoleRequest = input.request;
  const nextRole: AccessRoleRow = readNextAccessRole(role, request);
  const persistedRole: AccessRoleRow = await persistAccessRoleUpdate(
    tx,
    input.organizationId,
    input.roleId,
    role,
    nextRole,
    request.permissionKeys !== undefined,
  );
  return toAccessRoleSummary(persistedRole);
}

async function requireMutableAccessRoleWithExecutor(
  tx: RbacTransaction,
  organizationId: string,
  roleId: string,
): Promise<AccessRoleRow> {
  const role: AccessRoleRow = await requireAccessRoleWithExecutor(tx, organizationId, roleId);
  if (role.kind === 'system') {
    throw createAccessRoleImmutableError();
  }

  return role;
}

async function requireAccessRole(organizationId: string, roleId: string): Promise<AccessRoleRow> {
  const role: AccessRoleRow | undefined = await findAccessRoleById(organizationId, roleId);
  if (role === undefined) {
    throw createAccessRoleNotFoundError();
  }

  return role;
}

function toAccessRoleListRow(role: AccessRoleRow, usage: RoleUsageSummary | undefined): AccessRoleListRow {
  return {
    ...toAccessRoleSummary(role),
    assignmentCount: usage?.assignmentCount ?? 0,
    groupCount: usage?.groupCount ?? 0,
    principalCount: usage?.principalCount ?? 0,
  };
}

function readNextAccessRole(role: AccessRoleRow, request: UpdateAccessRoleRequest): AccessRoleRow {
  return {
    ...role,
    description: request.description === undefined ? role.description : normalizeDescription(request.description),
    name: request.name ?? role.name,
    permissionKeys: request.permissionKeys ?? role.permissionKeys,
  };
}

async function persistAccessRoleUpdate(
  tx: RbacTransaction,
  organizationId: string,
  roleId: string,
  currentRole: AccessRoleRow,
  nextRole: AccessRoleRow,
  shouldUpdatePermissions: boolean,
): Promise<AccessRoleRow> {
  const updatedAt: Date = new Date();
  const metadataRole: AccessRoleRow | null = await persistAccessRoleMetadataUpdate(
    tx,
    organizationId,
    roleId,
    currentRole,
    nextRole,
    updatedAt,
  );
  if (!shouldUpdatePermissions) {
    return metadataRole ?? (await requireAccessRoleWithExecutor(tx, organizationId, roleId));
  }

  return await persistAccessRolePermissionUpdate(tx, organizationId, roleId, nextRole, updatedAt);
}

async function persistAccessRoleMetadataUpdate(
  tx: RbacTransaction,
  organizationId: string,
  roleId: string,
  currentRole: AccessRoleRow,
  nextRole: AccessRoleRow,
  updatedAt: Date,
): Promise<AccessRoleRow | null> {
  const metadataChanged: boolean =
    nextRole.name !== currentRole.name || nextRole.description !== currentRole.description;
  if (!metadataChanged) {
    return null;
  }

  await assertAccessRoleNameAvailable(tx, organizationId, nextRole.name, roleId);
  return requirePersistedAccessRole(
    await renameAccessRoleWithExecutor(tx, organizationId, roleId, nextRole.name, nextRole.description, updatedAt),
  );
}

async function requireAccessRoleWithExecutor(
  tx: RbacTransaction,
  organizationId: string,
  roleId: string,
): Promise<AccessRoleRow> {
  const role: AccessRoleRow | undefined = await findAccessRoleByIdWithExecutor(tx, organizationId, roleId);
  if (role === undefined) {
    throw createAccessRoleNotFoundError();
  }

  return role;
}

async function persistAccessRolePermissionUpdate(
  tx: RbacTransaction,
  organizationId: string,
  roleId: string,
  nextRole: AccessRoleRow,
  updatedAt: Date,
): Promise<AccessRoleRow> {
  return requirePersistedAccessRole(
    await updateAccessRoleWithExecutor(tx, {
      description: nextRole.description,
      organizationId,
      permissionKeys: nextRole.permissionKeys,
      roleId,
      updatedAt,
    }),
  );
}

function requirePersistedAccessRole(role: AccessRoleRow | undefined): AccessRoleRow {
  if (role === undefined) {
    throw createAccessRoleNotFoundError();
  }

  return role;
}

function toAccessRoleSummary(role: AccessRoleRow): AccessRoleSummary {
  return {
    description: role.description,
    id: role.id,
    kind: role.kind,
    name: role.name,
    permissionKeys: role.permissionKeys,
  };
}

async function assertAccessRoleNameAvailable(
  tx: RbacTransaction,
  organizationId: string,
  roleName: string,
  roleId?: string,
): Promise<void> {
  const existingRole: AccessRoleRow | undefined = await findAccessRoleByNameWithExecutor(tx, organizationId, roleName);
  if (existingRole !== undefined && existingRole.id !== roleId) {
    throw createAccessRoleNameTakenError();
  }
}
