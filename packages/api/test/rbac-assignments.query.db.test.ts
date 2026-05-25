import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { PrincipalPermissionGrantRow } from '../src/queries/rbac.query.types';
import { deleteOrganizationAccessAssignment } from '../src/services/access-assignment-delete.service';
import {
  createOrganizationAccessAssignment,
  listOrganizationAccessAssignments,
} from '../src/services/access-assignments.service';
import type {
  AccessAssignmentMutationResult,
  AccessAssignmentResult,
} from '../src/services/access-assignments.service.types';
import { organizationMemberships } from '../src/db/schema';
import {
  listAllPrincipalPermissionGrantStates,
  listAccessAssignmentSummaries,
  listDirectAssignmentScopesForPrincipals,
  listDirectAccessAssignmentSummariesForPrincipal,
  listDirectPrincipalPermissionGrantRows,
  listEnvironmentScopedAssignmentEnvironmentIds,
  listGroupPrincipalPermissionGrantRows,
  listPrincipalGrantedRoleNames,
} from '../src/queries/rbac-assignments.query';
import {
  createRbacTestHarness,
  findRoleIdByName,
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
import { useApiRuntimeDatabaseTestHarness } from './api-db-test.harness';

interface PrincipalPermissionGrantState {
  permissionKey: string;
  principalId: string;
  scopeId: string;
  scopeType: 'environment' | 'organization' | 'project';
}

const harness: RbacTestHarness = createRbacTestHarness('rbac_assignments_query');
const adminPrincipalId: string = 'prn_admin';

describe('rbac assignments db', (): void => {
  useApiRuntimeDatabaseTestHarness({
    ...harness,
    setup: async (): Promise<void> => {
      await seedOrganization(harness, { id: 'org_123' });
      await seedSystemRoles(harness, 'org_123');
      await seedProject(harness, { id: 'prj_123', name: 'billing', organizationId: 'org_123' });
      await seedEnvironment(harness, { id: 'env_123', name: 'production', projectId: 'prj_123' });
      await seedPrincipal(harness, { email: 'viewer@example.com', id: 'prn_viewer', passwordHash: 'hashed' });
      await seedPrincipal(harness, { email: 'group@example.com', id: 'prn_group', passwordHash: 'hashed' });
      await seedPrincipal(harness, { email: 'admin@example.com', id: adminPrincipalId, passwordHash: 'hashed' });
      await seedOrganizationMembership(harness, {
        id: 'mem_admin',
        organizationId: 'org_123',
        principalId: adminPrincipalId,
      });
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
        id: 'rol_project_operator',
        name: 'Project Operator',
        organizationId: 'org_123',
        permissionKeys: ['deployment.create', 'variable.write'],
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
      await seedGroup(harness, { id: 'grp_123', name: 'Operators', organizationId: 'org_123' });
      await seedGroupMembership(harness, {
        groupId: 'grp_123',
        id: 'gmb_123',
        principalId: 'prn_group',
      });
    },
  });

  it('creates and deletes direct principal assignments with stable summaries', async (): Promise<void> => {
    const assignment: AccessAssignmentResult = (
      await createOrganizationAccessAssignment({
        actorPrincipalId: adminPrincipalId,
        organizationId: 'org_123',
        request: {
          roleId: 'rol_project_operator',
          scope: { projectName: 'billing', scopeType: 'project' },
          subject: { principalEmail: 'viewer@example.com', subjectType: 'principal' },
        },
      })
    ).assignment;

    expect(await listDirectAccessAssignmentSummariesForPrincipal('org_123', 'prn_viewer')).toMatchObject([
      {
        groupId: null,
        groupName: null,
        id: assignment.id,
        principalEmail: 'viewer@example.com',
        roleName: 'Project Operator',
        scopeType: 'project',
        subjectType: 'principal',
      },
    ]);
    expect(await listDirectAssignmentScopesForPrincipals('org_123', ['prn_viewer', 'prn_missing'])).toEqual([
      {
        principalId: 'prn_viewer',
        scopeId: 'prj_123',
        scopeType: 'project',
      },
    ]);
    expect(
      (await listDirectPrincipalPermissionGrantRows('org_123', 'prn_viewer')).map(
        (row: PrincipalPermissionGrantRow): string => row.permissionKey,
      ),
    ).toEqual(['deployment.create', 'variable.write']);
    expect(await listDirectAccessAssignmentSummariesForPrincipal('org_123', 'prn_viewer')).toMatchObject([
      {
        scopeId: 'prj_123',
        scopeType: 'project',
      },
    ]);

    await deleteOrganizationAccessAssignment({
      actorPrincipalId: adminPrincipalId,
      assignmentId: assignment.id,
      organizationId: 'org_123',
    });

    expect(await listDirectAccessAssignmentSummariesForPrincipal('org_123', 'prn_viewer')).toEqual([]);
  });

  it('skips assignments whose stored project or environment scope no longer exists', async (): Promise<void> => {
    await seedAssignment(harness, {
      id: 'asg_missing_project_scope',
      organizationId: 'org_123',
      roleId: 'rol_project_operator',
      scopeId: 'prj_missing',
      scopeType: 'project',
      subjectId: 'prn_viewer',
      subjectType: 'principal',
    });
    await seedAssignment(harness, {
      id: 'asg_missing_environment_scope',
      organizationId: 'org_123',
      roleId: 'rol_project_operator',
      scopeId: 'env_missing',
      scopeType: 'environment',
      subjectId: 'prn_viewer',
      subjectType: 'principal',
    });
    await seedAssignment(harness, {
      id: 'asg_present_environment_scope',
      organizationId: 'org_123',
      roleId: 'rol_project_operator',
      scopeId: 'env_123',
      scopeType: 'environment',
      subjectId: 'prn_viewer',
      subjectType: 'principal',
    });

    const assignments: AccessAssignmentResult[] = await listOrganizationAccessAssignments('org_123');
    const assignmentIds: string[] = assignments.map((assignment: AccessAssignmentResult): string => assignment.id);

    expect(assignmentIds).not.toContain('asg_missing_project_scope');
    expect(assignmentIds).not.toContain('asg_missing_environment_scope');
    expect(assignments).toContainEqual(
      expect.objectContaining({
        id: 'asg_present_environment_scope',
        scope: {
          environmentName: 'production',
          projectName: 'billing',
          scopeType: 'environment',
        },
      }),
    );
  });

  it('reuses the existing assignment row for duplicate subject-role-scope creates', async (): Promise<void> => {
    const first: AccessAssignmentMutationResult = await createOrganizationAccessAssignment({
      actorPrincipalId: adminPrincipalId,
      organizationId: 'org_123',
      request: {
        roleId: 'rol_project_operator',
        scope: { projectName: 'billing', scopeType: 'project' },
        subject: { principalEmail: 'viewer@example.com', subjectType: 'principal' },
      },
    });
    const second: AccessAssignmentMutationResult = await createOrganizationAccessAssignment({
      actorPrincipalId: adminPrincipalId,
      organizationId: 'org_123',
      request: {
        roleId: 'rol_project_operator',
        scope: { projectName: 'billing', scopeType: 'project' },
        subject: { principalEmail: 'viewer@example.com', subjectType: 'principal' },
      },
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.assignment.id).toBe(first.assignment.id);
  });

  it('expands group-derived permissions and scoped environment ids', async (): Promise<void> => {
    await seedAssignment(harness, {
      id: 'asg_group_env',
      organizationId: 'org_123',
      roleId: 'rol_project_operator',
      scopeId: 'env_123',
      scopeType: 'environment',
      subjectId: 'grp_123',
      subjectType: 'group',
    });

    expect(await listAccessAssignmentSummaries('org_123')).toContainEqual(
      expect.objectContaining({
        groupId: 'grp_123',
        groupName: 'Operators',
        principalEmail: null,
        roleName: 'Project Operator',
        scopeType: 'environment',
        subjectType: 'group',
      }),
    );
    expect(
      (await listGroupPrincipalPermissionGrantRows('org_123', 'prn_group')).map(
        (row: PrincipalPermissionGrantRow): string => row.permissionKey,
      ),
    ).toEqual(['deployment.create', 'variable.write']);
    expect(await listEnvironmentScopedAssignmentEnvironmentIds('org_123', 'prn_group')).toEqual(['env_123']);
  });

  it('lists distinct granted role names for multiple principals, skips blocked group memberships, and ignores empty-permission roles', async (): Promise<void> => {
    await seedCustomRole(harness, {
      id: 'rol_project_reader',
      name: 'Project Reader',
      organizationId: 'org_123',
      permissionKeys: ['project.read'],
    });
    await seedCustomRole(harness, {
      id: 'rol_dormant',
      name: 'Dormant Role',
      organizationId: 'org_123',
      permissionKeys: [],
    });
    await seedPrincipal(harness, { email: 'blocked@example.com', id: 'prn_blocked', passwordHash: 'hashed' });
    await seedOrganizationMembership(harness, {
      id: 'mem_blocked',
      organizationId: 'org_123',
      principalId: 'prn_blocked',
    });
    await seedGroupMembership(harness, {
      groupId: 'grp_123',
      id: 'gmb_blocked',
      principalId: 'prn_blocked',
    });
    await seedAssignment(harness, {
      id: 'asg_viewer_direct',
      organizationId: 'org_123',
      roleId: 'rol_project_operator',
      scopeId: 'prj_123',
      scopeType: 'project',
      subjectId: 'prn_viewer',
      subjectType: 'principal',
    });
    await seedAssignment(harness, {
      id: 'asg_viewer_dormant',
      organizationId: 'org_123',
      roleId: 'rol_dormant',
      scopeId: 'prj_123',
      scopeType: 'project',
      subjectId: 'prn_viewer',
      subjectType: 'principal',
    });
    await seedAssignment(harness, {
      id: 'asg_group_direct',
      organizationId: 'org_123',
      roleId: 'rol_project_operator',
      scopeId: 'prj_123',
      scopeType: 'project',
      subjectId: 'prn_group',
      subjectType: 'principal',
    });
    await seedAssignment(harness, {
      id: 'asg_group_role_operator',
      organizationId: 'org_123',
      roleId: 'rol_project_operator',
      scopeId: 'prj_123',
      scopeType: 'project',
      subjectId: 'grp_123',
      subjectType: 'group',
    });
    await seedAssignment(harness, {
      id: 'asg_group_role_reader',
      organizationId: 'org_123',
      roleId: 'rol_project_reader',
      scopeId: 'env_123',
      scopeType: 'environment',
      subjectId: 'grp_123',
      subjectType: 'group',
    });
    await seedAssignment(harness, {
      id: 'asg_group_role_dormant',
      organizationId: 'org_123',
      roleId: 'rol_dormant',
      scopeId: 'env_123',
      scopeType: 'environment',
      subjectId: 'grp_123',
      subjectType: 'group',
    });
    await harness.db
      .update(organizationMemberships)
      .set({ blockedAt: new Date('2026-05-05T10:00:00.000Z') })
      .where(eq(organizationMemberships.principalId, 'prn_blocked'));

    expect(await listPrincipalGrantedRoleNames('org_123', ['prn_group', 'prn_viewer', 'prn_blocked'])).toEqual([
      { principalId: 'prn_group', roleName: 'Project Operator' },
      { principalId: 'prn_group', roleName: 'Project Reader' },
      { principalId: 'prn_viewer', roleName: 'Project Operator' },
    ]);
  });

  it('filters blocked principals out of the app-access grant snapshot state', async (): Promise<void> => {
    await seedAssignment(harness, {
      id: 'asg_viewer',
      organizationId: 'org_123',
      roleId: 'rol_project_operator',
      scopeId: 'prj_123',
      scopeType: 'project',
      subjectId: 'prn_viewer',
      subjectType: 'principal',
    });
    await seedAssignment(harness, {
      id: 'asg_group',
      organizationId: 'org_123',
      roleId: 'rol_project_operator',
      scopeId: 'env_123',
      scopeType: 'environment',
      subjectId: 'grp_123',
      subjectType: 'group',
    });
    await harness.db
      .update(organizationMemberships)
      .set({ blockedAt: new Date('2026-05-05T10:00:00.000Z') })
      .where(eq(organizationMemberships.principalId, 'prn_group'));

    const grantStates: PrincipalPermissionGrantState[] = (await listAllPrincipalPermissionGrantStates()).filter(
      (row: PrincipalPermissionGrantState): boolean => row.principalId !== adminPrincipalId,
    );

    expect(grantStates).toMatchObject([
      {
        permissionKey: 'deployment.create',
        principalId: 'prn_viewer',
        scopeId: 'prj_123',
        scopeType: 'project',
      },
      {
        permissionKey: 'variable.write',
        principalId: 'prn_viewer',
        scopeId: 'prj_123',
        scopeType: 'project',
      },
    ]);
  });
});
