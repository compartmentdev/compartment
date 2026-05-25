import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { RbacTransaction } from '../src/queries/rbac.query.types';
import { isApiBusinessError } from '../src/errors/api-business-error';
import { organizationMemberships } from '../src/db/schema';
import { deleteAccessAssignmentWithExecutor } from '../src/queries/rbac-assignments.query';
import {
  requireAnySessionVisibleOrganizationAdminAccess,
  requireScopedPermission,
  resolveInheritedAccess,
} from '../src/services/access-scope.service';
import { createStoredSsoOidcProvider as createStoredSsoOidcProviderFixture } from './api-auth-session-test.fixtures';
import {
  clearRbacTestHarnessRuntime,
  closeRbacTestHarness,
  configureRbacTestRuntime,
  createRbacTestHarness,
  ensureRbacTestHarness,
  findRoleIdByName,
  resetRbacTestHarness,
  seedAssignment,
  seedCustomRole,
  seedEnvironment,
  seedGroup,
  seedGroupMembership,
  seedOrganization,
  seedOrganizationMembership,
  seedPrincipal,
  seedProject,
  seedSystemRoles,
  type RbacTestHarness,
} from './rbac-test.fixtures';

const harness: RbacTestHarness = createRbacTestHarness('access_scope_service');

describe('access scope service db', (): void => {
  beforeAll(async (): Promise<void> => {
    await ensureRbacTestHarness(harness);
  });

  beforeEach(async (): Promise<void> => {
    await resetRbacTestHarness(harness);
    configureRbacTestRuntime(harness);
    await seedOrganization(harness, { id: 'org_123' });
    await seedProject(harness, { id: 'prj_123', name: 'billing', organizationId: 'org_123' });
    await seedEnvironment(harness, { id: 'env_123', name: 'production', projectId: 'prj_123' });
    await seedPrincipal(harness, { email: 'viewer@example.com', id: 'prn_viewer', passwordHash: 'hashed' });
    await seedPrincipal(harness, { email: 'group@example.com', id: 'prn_group', passwordHash: 'hashed' });
    await seedOrganizationMembership(harness, {
      id: 'mem_viewer',
      organizationId: 'org_123',
      principalId: 'prn_viewer',
    });
    await seedOrganizationMembership(harness, {
      id: 'mem_group',
      organizationId: 'org_123',
      principalId: 'prn_group',
    });
    await seedCustomRole(harness, {
      id: 'rol_org_view',
      name: 'Org Viewer',
      organizationId: 'org_123',
      permissionKeys: ['project.read'],
    });
    await seedCustomRole(harness, {
      id: 'rol_env_logs',
      name: 'Env Logs',
      organizationId: 'org_123',
      permissionKeys: ['deployment.logs.read'],
    });
    await seedCustomRole(harness, {
      id: 'rol_env_read',
      name: 'Env Read',
      organizationId: 'org_123',
      permissionKeys: ['deployment.read'],
    });
    await seedGroup(harness, { id: 'grp_123', name: 'Operators', organizationId: 'org_123' });
    await seedGroupMembership(harness, {
      groupId: 'grp_123',
      id: 'gmb_123',
      principalId: 'prn_group',
    });
  });

  afterEach((): void => {
    clearRbacTestHarnessRuntime();
  });

  afterAll(async (): Promise<void> => {
    await closeRbacTestHarness(harness);
  });

  it('resolves direct organization, project, and environment access with nearest-scope precedence', async (): Promise<void> => {
    await seedAssignment(harness, {
      id: 'asg_org',
      organizationId: 'org_123',
      roleId: 'rol_org_view',
      scopeId: 'org_123',
      scopeType: 'organization',
      subjectId: 'prn_viewer',
      subjectType: 'principal',
    });
    await seedAssignment(harness, {
      id: 'asg_env',
      organizationId: 'org_123',
      roleId: 'rol_env_logs',
      scopeId: 'env_123',
      scopeType: 'environment',
      subjectId: 'prn_viewer',
      subjectType: 'principal',
    });

    expect(
      await resolveInheritedAccess({
        organizationId: 'org_123',
        principalId: 'prn_viewer',
        routeScope: { scopeId: 'env_123', scopeType: 'environment' },
      }),
    ).toEqual({
      grantedScopeId: 'env_123',
      grantedScopeType: 'environment',
      permissions: ['deployment.logs.read'],
    });
    await expect(
      requireScopedPermission({
        organizationId: 'org_123',
        permission: 'project.read',
        principalId: 'prn_viewer',
        routeScope: { scopeId: 'env_123', scopeType: 'environment' },
      }),
    ).rejects.toSatisfy(
      (error: Error | null | undefined): boolean => isApiBusinessError(error) && error.code === 'forbidden',
    );
  });

  it('unions permissions at the same scope and resolves group-derived grants', async (): Promise<void> => {
    await seedAssignment(harness, {
      id: 'asg_group_logs',
      organizationId: 'org_123',
      roleId: 'rol_env_logs',
      scopeId: 'env_123',
      scopeType: 'environment',
      subjectId: 'grp_123',
      subjectType: 'group',
    });
    await seedAssignment(harness, {
      id: 'asg_group_read',
      organizationId: 'org_123',
      roleId: 'rol_env_read',
      scopeId: 'env_123',
      scopeType: 'environment',
      subjectId: 'grp_123',
      subjectType: 'group',
    });

    expect(
      await requireScopedPermission({
        organizationId: 'org_123',
        permission: 'deployment.logs.read',
        principalId: 'prn_group',
        routeScope: { scopeId: 'env_123', scopeType: 'environment' },
      }),
    ).toEqual({
      grantedScopeId: 'env_123',
      grantedScopeType: 'environment',
      permissions: ['deployment.logs.read', 'deployment.read'],
    });
  });

  it('accepts group-derived system admin access for organization-creation checks', async (): Promise<void> => {
    await seedSystemRoles(harness, 'org_123');
    await seedAssignment(harness, {
      id: 'asg_group_admin',
      organizationId: 'org_123',
      roleId: await findRoleIdByName(harness, 'org_123', 'admin'),
      scopeId: 'org_123',
      scopeType: 'organization',
      subjectId: 'grp_123',
      subjectType: 'group',
    });

    await expect(
      requireAnySessionVisibleOrganizationAdminAccess({
        authMethodKind: 'password',
        oidcProviderId: null,
        organizationId: 'org_123',
        principalId: 'prn_group',
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects organization-creation checks when admin access only exists in a hidden organization', async (): Promise<void> => {
    await createStoredSsoOidcProviderFixture({
      db: harness.db,
      organizationId: 'org_123',
      providerId: 'sop_visible',
      variablesMasterKey: harness.apiConfig.variablesMasterKey,
    });
    await seedOrganization(harness, { id: 'org_456', name: 'Hidden Org', slug: 'hidden-org' });
    await seedOrganizationMembership(harness, {
      id: 'mem_viewer_hidden',
      organizationId: 'org_456',
      principalId: 'prn_viewer',
    });
    await seedSystemRoles(harness, 'org_456');
    await seedAssignment(harness, {
      id: 'asg_hidden_admin',
      organizationId: 'org_456',
      roleId: await findRoleIdByName(harness, 'org_456', 'admin'),
      scopeId: 'org_456',
      scopeType: 'organization',
      subjectId: 'prn_viewer',
      subjectType: 'principal',
    });

    await expect(
      requireAnySessionVisibleOrganizationAdminAccess({
        authMethodKind: 'oidc',
        oidcProviderId: 'sop_visible',
        organizationId: 'org_123',
        principalId: 'prn_viewer',
      }),
    ).rejects.toSatisfy(
      (error: Error | null | undefined): boolean => isApiBusinessError(error) && error.code === 'forbidden',
    );
  });

  it('revokes access after assignment deletion and membership blocking', async (): Promise<void> => {
    await seedAssignment(harness, {
      id: 'asg_viewer',
      organizationId: 'org_123',
      roleId: 'rol_org_view',
      scopeId: 'org_123',
      scopeType: 'organization',
      subjectId: 'prn_viewer',
      subjectType: 'principal',
    });

    await harness.db.transaction(async (tx: RbacTransaction): Promise<void> => {
      await deleteAccessAssignmentWithExecutor(tx, 'org_123', 'asg_viewer');
    });
    expect(
      await resolveInheritedAccess({
        organizationId: 'org_123',
        principalId: 'prn_viewer',
        routeScope: { scopeId: 'prj_123', scopeType: 'project' },
      }),
    ).toBeNull();

    await seedAssignment(harness, {
      id: 'asg_blocked',
      organizationId: 'org_123',
      roleId: 'rol_org_view',
      scopeId: 'org_123',
      scopeType: 'organization',
      subjectId: 'prn_viewer',
      subjectType: 'principal',
    });
    await harness.db
      .update(organizationMemberships)
      .set({ blockedAt: new Date('2026-05-05T10:00:00.000Z') })
      .where(eq(organizationMemberships.id, 'mem_viewer'));

    expect(
      await resolveInheritedAccess({
        organizationId: 'org_123',
        principalId: 'prn_viewer',
        routeScope: { scopeId: 'prj_123', scopeType: 'project' },
      }),
    ).toBeNull();
  });
});
