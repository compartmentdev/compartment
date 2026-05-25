import { listCompartmentRolePermissions, type CompartmentMembershipRole } from '@compartment/contracts';
import { createId } from '../lib/tokens';
import { createAccessAssignmentWithExecutor } from '../queries/rbac-assignments.query';
import { createAccessRoleWithExecutor, findAccessRoleByNameWithExecutor } from '../queries/rbac-roles.query';
import type { AccessRoleRow, RbacTransaction } from '../queries/rbac.query.types';

const systemRoleNames: readonly CompartmentMembershipRole[] = ['admin', 'deployer', 'readonly', 'viewer'];

export async function assignOrganizationSystemRoleToPrincipalWithExecutor(
  executor: RbacTransaction,
  organizationId: string,
  principalId: string,
  roleName: CompartmentMembershipRole,
): Promise<void> {
  const roles: Record<CompartmentMembershipRole, AccessRoleRow> = await ensureOrganizationSystemRolesWithExecutor(
    executor,
    organizationId,
    new Date(),
  );

  await createAccessAssignmentWithExecutor(executor, {
    id: createId('asg'),
    organizationId,
    roleId: roles[roleName].id,
    scopeId: organizationId,
    scopeType: 'organization',
    subjectId: principalId,
    subjectType: 'principal',
  });
}

async function ensureOrganizationSystemRolesWithExecutor(
  executor: RbacTransaction,
  organizationId: string,
  now: Date,
): Promise<Record<CompartmentMembershipRole, AccessRoleRow>> {
  const roles: Record<CompartmentMembershipRole, AccessRoleRow> = {} as Record<
    CompartmentMembershipRole,
    AccessRoleRow
  >;

  for (const roleName of systemRoleNames) {
    roles[roleName] = await readOrCreateSystemRole(executor, organizationId, roleName, now);
  }

  return roles;
}

async function readOrCreateSystemRole(
  executor: RbacTransaction,
  organizationId: string,
  roleName: CompartmentMembershipRole,
  now: Date,
): Promise<AccessRoleRow> {
  const existingRole: AccessRoleRow | undefined = await findAccessRoleByNameWithExecutor(
    executor,
    organizationId,
    roleName,
  );
  if (existingRole !== undefined) {
    return existingRole;
  }

  return await createAccessRoleWithExecutor(executor, {
    description: null,
    id: createId('rol'),
    kind: 'system',
    name: roleName,
    organizationId,
    permissionKeys: listCompartmentRolePermissions(roleName),
    updatedAt: now,
  });
}
