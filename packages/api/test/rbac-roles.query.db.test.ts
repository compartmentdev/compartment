import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AccessRoleSummary } from '@compartment/contracts';
import { isApiBusinessError } from '../src/errors/api-business-error';
import type { AccessRoleRow } from '../src/queries/rbac.query.types';
import { findAccessRoleById, listAccessRoles } from '../src/queries/rbac-roles.query';
import {
  createOrganizationAccessRole,
  deleteOrganizationAccessRole,
  listOrganizationAccessRolesPage,
  updateOrganizationAccessRole,
} from '../src/services/access-roles.service';
import type { OrganizationAccessRolesPageResult } from '../src/services/access-roles.service.types';
import {
  clearRbacTestHarnessRuntime,
  closeRbacTestHarness,
  configureRbacTestRuntime,
  createRbacTestHarness,
  ensureRbacTestHarness,
  resetRbacTestHarness,
  findRoleIdByName,
  seedAssignment,
  seedCustomRole,
  seedGroup,
  seedOrganization,
  seedOrganizationMembership,
  seedPrincipal,
  seedSystemRoles,
  type RbacTestHarness,
} from './rbac-test.fixtures';

const harness: RbacTestHarness = createRbacTestHarness('rbac_roles_query');
const adminPrincipalId: string = 'prn_admin';

describe('rbac roles db', (): void => {
  beforeAll(async (): Promise<void> => {
    await ensureRbacTestHarness(harness);
  });

  beforeEach(async (): Promise<void> => {
    await resetRbacTestHarness(harness);
    configureRbacTestRuntime(harness);
    await seedOrganization(harness, { id: 'org_123' });
    await seedSystemRoles(harness, 'org_123');
    await seedPrincipal(harness, { email: 'admin@example.com', id: adminPrincipalId, passwordHash: 'hashed' });
    await seedOrganizationMembership(harness, {
      id: 'mem_admin',
      organizationId: 'org_123',
      principalId: adminPrincipalId,
    });
    await seedAssignment(harness, {
      id: 'asg_admin',
      organizationId: 'org_123',
      roleId: await findRoleIdByName(harness, 'org_123', 'admin'),
      scopeId: 'org_123',
      scopeType: 'organization',
      subjectId: adminPrincipalId,
      subjectType: 'principal',
    });
  });

  afterEach((): void => {
    clearRbacTestHarnessRuntime();
  });

  afterAll(async (): Promise<void> => {
    await closeRbacTestHarness(harness);
  });

  it('creates, updates, reads, and deletes a custom role', async (): Promise<void> => {
    const created: AccessRoleSummary = await createOrganizationAccessRole({
      actorPrincipalId: adminPrincipalId,
      organizationId: 'org_123',
      request: {
        name: 'Project Operator',
        permissionKeys: ['deployment.create', 'variable.write'],
      },
    });

    const updated: AccessRoleSummary = await updateOrganizationAccessRole({
      actorPrincipalId: adminPrincipalId,
      organizationId: 'org_123',
      request: {
        permissionKeys: ['deployment.read', 'variable.metadata.read'],
      },
      roleId: created.id,
    });
    expect(updated).toMatchObject({
      id: created.id,
      name: 'Project Operator',
      permissionKeys: ['deployment.read', 'variable.metadata.read'],
    });

    expect(await findAccessRoleById('org_123', created.id)).toMatchObject({
      kind: 'custom',
      name: 'Project Operator',
      permissionKeys: ['deployment.read', 'variable.metadata.read'],
    });

    await deleteOrganizationAccessRole({ organizationId: 'org_123', roleId: created.id });

    expect(await findAccessRoleById('org_123', created.id)).toBeUndefined();
  });

  it('rejects duplicate custom role names within an organization', async (): Promise<void> => {
    await createOrganizationAccessRole({
      actorPrincipalId: adminPrincipalId,
      organizationId: 'org_123',
      request: {
        name: 'Project Operator',
        permissionKeys: ['deployment.create'],
      },
    });

    await expect(
      createOrganizationAccessRole({
        actorPrincipalId: adminPrincipalId,
        organizationId: 'org_123',
        request: {
          name: 'Project Operator',
          permissionKeys: ['deployment.read'],
        },
      }),
    ).rejects.toSatisfy(
      (error: Error | null | undefined): boolean =>
        error instanceof Error && isApiBusinessError(error) && error.code === 'access_role_name_taken',
    );
  });

  it('keeps system roles immutable', async (): Promise<void> => {
    const adminRole: AccessRoleRow | undefined = (await listAccessRoles('org_123')).find(
      (role: AccessRoleRow): boolean => role.name === 'admin',
    );
    expect(adminRole).toBeDefined();

    await expect(
      updateOrganizationAccessRole({
        actorPrincipalId: adminPrincipalId,
        organizationId: 'org_123',
        request: { permissionKeys: ['project.read'] },
        roleId: adminRole!.id,
      }),
    ).rejects.toSatisfy(
      (error: Error | null | undefined): boolean =>
        error instanceof Error && isApiBusinessError(error) && error.code === 'access_role_immutable',
    );
    await expect(deleteOrganizationAccessRole({ organizationId: 'org_123', roleId: adminRole!.id })).rejects.toSatisfy(
      (error: Error | null | undefined): boolean =>
        error instanceof Error && isApiBusinessError(error) && error.code === 'access_role_immutable',
    );
  });

  it('pages roles through permission-key search, escaped wildcards, and non-name orderings', async (): Promise<void> => {
    await seedCustomRole(harness, {
      id: 'rol_launch_captain',
      name: 'Launch Captain',
      organizationId: 'org_123',
      permissionKeys: ['variable.write'],
    });
    await seedCustomRole(harness, {
      id: 'rol_100_percent_ops',
      name: '100% Ops',
      organizationId: 'org_123',
      permissionKeys: ['deployment.read'],
    });
    await seedCustomRole(harness, {
      id: 'rol_heavy_ops',
      name: 'Heavy Ops',
      organizationId: 'org_123',
      permissionKeys: ['project.read'],
    });
    await seedGroup(harness, {
      id: 'grp_heavy_ops',
      name: 'Heavy Operators',
      organizationId: 'org_123',
    });
    await seedAssignment(harness, {
      id: 'asg_heavy_principal',
      organizationId: 'org_123',
      roleId: 'rol_heavy_ops',
      scopeId: 'org_123',
      scopeType: 'organization',
      subjectId: adminPrincipalId,
      subjectType: 'principal',
    });
    await seedAssignment(harness, {
      id: 'asg_heavy_group',
      organizationId: 'org_123',
      roleId: 'rol_heavy_ops',
      scopeId: 'org_123',
      scopeType: 'organization',
      subjectId: 'grp_heavy_ops',
      subjectType: 'group',
    });

    const permissionSearch: OrganizationAccessRolesPageResult = await listOrganizationAccessRolesPage({
      organizationId: 'org_123',
      orderBy: 'name',
      page: 1,
      perPage: 20,
      search: 'variable.write',
      sort: 'asc',
    });
    expect(permissionSearch.roles.map((role: AccessRoleSummary): string => role.id)).toContain('rol_launch_captain');

    const wildcardSearch: OrganizationAccessRolesPageResult = await listOrganizationAccessRolesPage({
      organizationId: 'org_123',
      orderBy: 'name',
      page: 1,
      perPage: 20,
      search: '100%',
      sort: 'asc',
    });
    expect(wildcardSearch.roles.map((role: AccessRoleSummary): string => role.id)).toEqual(['rol_100_percent_ops']);

    const assignmentCountPage: OrganizationAccessRolesPageResult = await listOrganizationAccessRolesPage({
      organizationId: 'org_123',
      orderBy: 'assignmentCount',
      page: 1,
      perPage: 20,
      sort: 'desc',
    });
    expect(assignmentCountPage.roles[0]?.id).toBe('rol_heavy_ops');

    const kindPage: OrganizationAccessRolesPageResult = await listOrganizationAccessRolesPage({
      organizationId: 'org_123',
      orderBy: 'kind',
      page: 1,
      perPage: 20,
      sort: 'asc',
    });
    expect(kindPage.roles[0]?.kind).toBe('custom');
  });
});
