import type { LightMyRequestResponse } from 'fastify';
import {
  type AccessAssignmentSummary,
  type AuditEventSummary,
  type AccessGroupSummary,
  type AccessGroupListPageResponse,
  type AccessGroupListOptionsResponse,
  type AccessRoleSummary,
  type AccessRoleListPageResponse,
  type AccessRoleListOptionsResponse,
  type UserAccessDetail,
  accessAssignmentListResponseSchema,
  accessAssignmentResponseSchema,
  accessAssignmentScopeOptionsResponseSchema,
  auditEventListResponseSchema,
  errorResponseSchema,
  accessGroupListResponseSchema,
  accessGroupListPageResponseSchema,
  accessGroupListOptionsResponseSchema,
  accessGroupMemberListResponseSchema,
  accessGroupResponseSchema,
  accessRoleListResponseSchema,
  accessRoleListOptionsResponseSchema,
  accessRoleListPageResponseSchema,
  accessRoleResponseSchema,
  buildCompartmentUserAccessApiPathname,
  compartmentAssignmentsPathname,
  compartmentAssignmentScopeOptionsPathname,
  compartmentAuditEventsExportPathname,
  compartmentAuditEventsPathname,
  compartmentGroupsPathname,
  compartmentRolesPathname,
  inviteUserResponseSchema,
  userAccessDetailResponseSchema,
  type InstallResponse,
} from '@compartment/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { createApp } from '../src/app';
import type { ApiApp } from '../src/app.types';
import { auditEvents as auditEventsTable } from '../src/db/schema';
import { buildOrganizationAuthorizationHeaders, installCompartment } from './api-integration.harness';
import {
  createRbacTestHarness,
  ensureRbacTestHarness,
  resetRbacTestHarness,
  seedEnvironment,
  seedCustomRole,
  seedGroup,
  seedProject,
  type RbacTestHarness,
} from './rbac-test.fixtures';

interface AppAccessEdgeServiceModule {
  invalidateEdgeAppAccessSessions: () => Promise<void>;
  synchronizeEdgeAppAccessState: () => Promise<void>;
}

vi.mock(
  '../src/services/app-access-edge.service',
  (): AppAccessEdgeServiceModule => ({
    invalidateEdgeAppAccessSessions: async (): Promise<void> => await Promise.resolve(),
    synchronizeEdgeAppAccessState: async (): Promise<void> => await Promise.resolve(),
  }),
);

const hourMs: number = 60 * 60 * 1000;
const auditOrderingAnchorMs: number = Date.now();

const harness: RbacTestHarness = createRbacTestHarness('api_rbac_crud_integration');
const app: ApiApp = createApp({ config: harness.apiConfig, pool: harness.pool });

describe('rbac crud integration', (): void => {
  beforeAll(async (): Promise<void> => {
    await ensureRbacTestHarness(harness);
  });

  beforeEach(async (): Promise<void> => {
    await resetRbacTestHarness(harness);
  });

  afterEach((): void => {
    vi.unstubAllGlobals();
  });

  afterAll(async (): Promise<void> => {
    await app.close();
  });

  it('seeds creator admin roles and keeps invited users membership-only', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const rolesResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'GET',
      url: compartmentRolesPathname,
    });
    expect(rolesResponse.statusCode).toBe(200);
    expect(
      accessRoleListResponseSchema.parse(rolesResponse.json()).roles.map((role: { name: string }): string => role.name),
    ).toEqual(['admin', 'deployer', 'readonly', 'viewer']);

    const inviteResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'POST',
      payload: { email: 'viewer@example.com' },
      url: '/v1/users',
    });
    expect(inviteResponse.statusCode).toBe(200);
    expect(inviteUserResponseSchema.parse(inviteResponse.json()).user).toMatchObject({
      email: 'viewer@example.com',
      groupCount: 0,
      roleNames: [],
      status: 'invited',
    });

    const accessResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'GET',
      url: buildCompartmentUserAccessApiPathname('viewer@example.com'),
    });
    expect(accessResponse.statusCode).toBe(200);
    expect(userAccessDetailResponseSchema.parse(accessResponse.json()).access).toMatchObject({
      directAssignments: [],
      effectivePermissions: [],
      groups: [],
      user: {
        email: 'viewer@example.com',
        roleNames: [],
      },
    });
  });

  it('supports role, group, group member, assignment, and scope-options CRUD through the API', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await seedProject(harness, {
      id: 'prj_123',
      name: 'billing',
      organizationId: installPayload.organization.id,
    });
    await seedEnvironment(harness, {
      id: 'env_123',
      name: 'production',
      projectId: 'prj_123',
    });

    const inviteResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'POST',
      payload: { email: 'viewer@example.com' },
      url: '/v1/users',
    });
    expect(inviteResponse.statusCode).toBe(200);
    const invitedUserBootstrapToken: string | undefined = inviteUserResponseSchema.parse(inviteResponse.json())
      .invitation?.bootstrapToken;

    const roleResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'POST',
      payload: {
        name: 'Project Operator',
        permissionKeys: ['deployment.create', 'variable.write'],
      },
      url: compartmentRolesPathname,
    });
    expect(roleResponse.statusCode).toBe(200);
    const role: AccessRoleSummary = accessRoleResponseSchema.parse(roleResponse.json()).role;
    expect(role.name).toBe('Project Operator');

    const groupResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'POST',
      payload: { name: 'Operators' },
      url: compartmentGroupsPathname,
    });
    expect(groupResponse.statusCode).toBe(200);
    const group: AccessGroupSummary = accessGroupResponseSchema.parse(groupResponse.json()).group;

    const addMemberResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'POST',
      payload: { email: 'viewer@example.com' },
      url: `${compartmentGroupsPathname}/${group.id}/members`,
    });
    expect(addMemberResponse.statusCode).toBe(200);
    expect(accessGroupMemberListResponseSchema.parse(addMemberResponse.json()).members).toMatchObject([
      {
        email: 'viewer@example.com',
        status: 'invited',
      },
    ]);
    const duplicateAddMemberResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'POST',
      payload: { email: 'viewer@example.com' },
      url: `${compartmentGroupsPathname}/${group.id}/members`,
    });
    expect(duplicateAddMemberResponse.statusCode).toBe(200);
    expect(accessGroupMemberListResponseSchema.parse(duplicateAddMemberResponse.json()).members).toHaveLength(1);

    const assignmentResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'POST',
      payload: {
        roleId: role.id,
        scope: {
          projectName: 'billing',
          scopeType: 'project',
        },
        subject: {
          groupId: group.id,
          subjectType: 'group',
        },
      },
      url: compartmentAssignmentsPathname,
    });
    expect(assignmentResponse.statusCode).toBe(200);
    const assignment: AccessAssignmentSummary = accessAssignmentResponseSchema.parse(
      assignmentResponse.json(),
    ).assignment;
    const duplicateAssignmentResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'POST',
      payload: {
        roleId: role.id,
        scope: {
          projectName: 'billing',
          scopeType: 'project',
        },
        subject: {
          groupId: group.id,
          subjectType: 'group',
        },
      },
      url: compartmentAssignmentsPathname,
    });
    expect(duplicateAssignmentResponse.statusCode).toBe(200);
    expect(accessAssignmentResponseSchema.parse(duplicateAssignmentResponse.json()).assignment.id).toBe(assignment.id);

    const groupsResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'GET',
      url: compartmentGroupsPathname,
    });
    expect(groupsResponse.statusCode).toBe(200);
    expect(accessGroupListResponseSchema.parse(groupsResponse.json()).groups).toMatchObject([
      {
        assignedRoleNames: ['Project Operator'],
        assignmentScopeLabels: ['billing'],
        id: group.id,
        name: 'Operators',
      },
    ]);

    const assignmentsResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'GET',
      url: compartmentAssignmentsPathname,
    });
    expect(assignmentsResponse.statusCode).toBe(200);
    expect(readAssignmentById(assignmentsResponse, assignment.id)).toMatchObject({
      id: assignment.id,
      roleId: role.id,
      subject: {
        groupId: group.id,
        groupName: 'Operators',
      },
    });

    const scopeOptionsResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'GET',
      url: compartmentAssignmentScopeOptionsPathname,
    });
    expect(scopeOptionsResponse.statusCode).toBe(200);
    expect(accessAssignmentScopeOptionsResponseSchema.parse(scopeOptionsResponse.json()).projects).toEqual([
      {
        environmentNames: ['production'],
        projectName: 'billing',
      },
    ]);

    const accessResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'GET',
      url: buildCompartmentUserAccessApiPathname('viewer@example.com'),
    });
    expect(accessResponse.statusCode).toBe(200);
    expect(readUserAccessDetail(accessResponse)).toMatchObject({
      directAssignments: [],
      effectivePermissions: ['deployment.create', 'variable.write'],
      groups: [{ id: group.id, name: 'Operators' }],
    });

    const deleteAssignmentResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'DELETE',
      url: `${compartmentAssignmentsPathname}/${assignment.id}`,
    });
    expect(deleteAssignmentResponse.statusCode).toBe(200);
    expect(accessAssignmentResponseSchema.parse(deleteAssignmentResponse.json()).assignment.id).toBe(assignment.id);

    const assignmentsAfterDeleteResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'GET',
      url: compartmentAssignmentsPathname,
    });
    expect(assignmentsAfterDeleteResponse.statusCode).toBe(200);
    expect(
      readAssignments(assignmentsAfterDeleteResponse).every(
        (item: AccessAssignmentSummary): boolean => item.roleId !== role.id,
      ),
    ).toBe(true);

    const groupsAfterAssignmentDeleteResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'GET',
      url: compartmentGroupsPathname,
    });
    expect(groupsAfterAssignmentDeleteResponse.statusCode).toBe(200);
    expect(accessGroupListResponseSchema.parse(groupsAfterAssignmentDeleteResponse.json()).groups).toMatchObject([
      {
        assignedRoleNames: [],
        assignmentScopeLabels: [],
        id: group.id,
      },
    ]);

    const accessAfterAssignmentDeleteResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'GET',
      url: buildCompartmentUserAccessApiPathname('viewer@example.com'),
    });
    expect(accessAfterAssignmentDeleteResponse.statusCode).toBe(200);
    expect(readUserAccessDetail(accessAfterAssignmentDeleteResponse)).toMatchObject({
      directAssignments: [],
      effectivePermissions: [],
      groups: [{ id: group.id, name: 'Operators' }],
    });

    const removeMemberResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'DELETE',
      url: `${compartmentGroupsPathname}/${group.id}/members/${encodeURIComponent('viewer@example.com')}`,
    });
    expect(removeMemberResponse.statusCode).toBe(200);
    expect(accessGroupMemberListResponseSchema.parse(removeMemberResponse.json()).members).toEqual([]);
    const duplicateRemoveMemberResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'DELETE',
      url: `${compartmentGroupsPathname}/${group.id}/members/${encodeURIComponent('viewer@example.com')}`,
    });
    expect(duplicateRemoveMemberResponse.statusCode).toBe(200);
    expect(accessGroupMemberListResponseSchema.parse(duplicateRemoveMemberResponse.json()).members).toEqual([]);
    const readdMemberResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'POST',
      payload: { email: 'viewer@example.com' },
      url: `${compartmentGroupsPathname}/${group.id}/members`,
    });
    expect(readdMemberResponse.statusCode).toBe(200);

    const recreatedAssignmentResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'POST',
      payload: {
        roleId: role.id,
        scope: {
          projectName: 'billing',
          scopeType: 'project',
        },
        subject: {
          groupId: group.id,
          subjectType: 'group',
        },
      },
      url: compartmentAssignmentsPathname,
    });
    expect(recreatedAssignmentResponse.statusCode).toBe(200);

    const deleteGroupResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'DELETE',
      url: `${compartmentGroupsPathname}/${group.id}`,
    });
    expect(deleteGroupResponse.statusCode).toBe(200);
    expect(accessGroupResponseSchema.parse(deleteGroupResponse.json()).group.id).toBe(group.id);

    const groupsAfterDeleteResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'GET',
      url: compartmentGroupsPathname,
    });
    expect(groupsAfterDeleteResponse.statusCode).toBe(200);
    expect(accessGroupListResponseSchema.parse(groupsAfterDeleteResponse.json()).groups).toEqual([]);

    const assignmentsAfterGroupDeleteResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'GET',
      url: compartmentAssignmentsPathname,
    });
    expect(assignmentsAfterGroupDeleteResponse.statusCode).toBe(200);
    expect(
      readAssignments(assignmentsAfterGroupDeleteResponse).every(
        (item: AccessAssignmentSummary): boolean => item.roleId !== role.id,
      ),
    ).toBe(true);

    const accessAfterGroupDeleteResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'GET',
      url: buildCompartmentUserAccessApiPathname('viewer@example.com'),
    });
    expect(accessAfterGroupDeleteResponse.statusCode).toBe(200);
    expect(readUserAccessDetail(accessAfterGroupDeleteResponse)).toMatchObject({
      directAssignments: [],
      effectivePermissions: [],
      groups: [],
    });

    const directAssignmentResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'POST',
      payload: {
        roleId: role.id,
        scope: {
          projectName: 'billing',
          scopeType: 'project',
        },
        subject: {
          principalEmail: 'viewer@example.com',
          subjectType: 'principal',
        },
      },
      url: compartmentAssignmentsPathname,
    });
    expect(directAssignmentResponse.statusCode).toBe(200);
    const directAssignment: AccessAssignmentSummary = accessAssignmentResponseSchema.parse(
      directAssignmentResponse.json(),
    ).assignment;

    const accessAfterDirectAssignmentResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'GET',
      url: buildCompartmentUserAccessApiPathname('viewer@example.com'),
    });
    expect(accessAfterDirectAssignmentResponse.statusCode).toBe(200);
    expect(readUserAccessDetail(accessAfterDirectAssignmentResponse)).toMatchObject({
      directAssignments: [expect.objectContaining({ id: directAssignment.id, roleId: role.id })],
      effectivePermissions: ['deployment.create', 'variable.write'],
      groups: [],
    });

    const deleteRoleResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'DELETE',
      url: `${compartmentRolesPathname}/${role.id}`,
    });
    expect(deleteRoleResponse.statusCode).toBe(200);
    expect(accessRoleResponseSchema.parse(deleteRoleResponse.json()).role.id).toBe(role.id);

    const rolesAfterDeleteResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'GET',
      url: compartmentRolesPathname,
    });
    expect(rolesAfterDeleteResponse.statusCode).toBe(200);
    const remainingRoleNames: string[] = accessRoleListResponseSchema
      .parse(rolesAfterDeleteResponse.json())
      .roles.map((item: { name: string }): string => item.name);
    expect(remainingRoleNames).not.toContain('Project Operator');
    expect(remainingRoleNames).toEqual(expect.arrayContaining(['admin', 'deployer', 'readonly', 'viewer']));

    const assignmentsAfterRoleDeleteResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'GET',
      url: compartmentAssignmentsPathname,
    });
    expect(assignmentsAfterRoleDeleteResponse.statusCode).toBe(200);
    expect(
      readAssignments(assignmentsAfterRoleDeleteResponse).every(
        (item: AccessAssignmentSummary): boolean => item.roleId !== role.id,
      ),
    ).toBe(true);

    const accessAfterRoleDeleteResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'GET',
      url: buildCompartmentUserAccessApiPathname('viewer@example.com'),
    });
    expect(accessAfterRoleDeleteResponse.statusCode).toBe(200);
    expect(readUserAccessDetail(accessAfterRoleDeleteResponse)).toMatchObject({
      directAssignments: [],
      effectivePermissions: [],
      groups: [],
    });

    const auditEventsResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'GET',
      query: { perPage: '100' },
      url: compartmentAuditEventsPathname,
    });
    expect(auditEventsResponse.statusCode).toBe(200);
    const auditEvents: AuditEventSummary[] = auditEventListResponseSchema.parse(auditEventsResponse.json()).events;
    expect(readAuditEventTypes(auditEvents)).toEqual(
      expect.arrayContaining([
        'organization.assignment.created',
        'organization.assignment.deleted',
        'organization.group.created',
        'organization.group.deleted',
        'organization.group.member_added',
        'organization.group.member_removed',
        'organization.role.created',
        'organization.role.deleted',
        'organization.user.invited',
      ]),
    );
    expect(countAuditEventType(auditEvents, 'organization.assignment.created')).toBe(3);
    expect(countAuditEventType(auditEvents, 'organization.group.member_added')).toBe(2);
    expect(countAuditEventType(auditEvents, 'organization.group.member_removed')).toBe(1);
    if (invitedUserBootstrapToken !== undefined) {
      expect(JSON.stringify(auditEvents)).not.toContain(invitedUserBootstrapToken);
    }

    await harness.db.insert(auditEventsTable).values({
      actorEmail: '=formula@example.com',
      actorType: 'user',
      eventType: 'organization.settings.updated',
      id: 'aud_formula_guard',
      metadataJson: '{}',
      organizationId: installPayload.organization.id,
      scopeType: 'organization',
      status: 'succeeded',
      targetDisplayName: '+Acme Dev',
      targetId: installPayload.organization.id,
      targetType: 'organization',
    });
    const auditCsvExportResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'POST',
      query: { format: 'csv' },
      url: compartmentAuditEventsExportPathname,
    });
    expect(auditCsvExportResponse.statusCode).toBe(200);
    expect(auditCsvExportResponse.headers['content-type']).toContain('text/csv');
    expect(auditCsvExportResponse.body).toContain('eventType');
    expect(auditCsvExportResponse.body).toContain("'=formula@example.com");
    expect(auditCsvExportResponse.body).toContain("'+Acme Dev");

    const auditEventsAfterExportResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'GET',
      query: { eventType: 'audit.export.created' },
      url: compartmentAuditEventsPathname,
    });
    expect(auditEventsAfterExportResponse.statusCode).toBe(200);
    expect(auditEventListResponseSchema.parse(auditEventsAfterExportResponse.json()).events).toHaveLength(1);
  });

  it('lists roles through the paginated list contract with search and sorting', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await seedCustomRole(harness, {
      id: 'rol_alpha_operator',
      name: 'Alpha Operator',
      organizationId: installPayload.organization.id,
      permissionKeys: ['project.read'],
    });
    await seedCustomRole(harness, {
      id: 'rol_beta_operator',
      name: 'Beta Operator',
      organizationId: installPayload.organization.id,
      permissionKeys: ['variable.write'],
    });

    const response: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'GET',
      url: `${compartmentRolesPathname}?detail=list&search=operator&orderBy=name&sort=desc&page=1&perPage=1`,
    });

    expect(response.statusCode).toBe(200);
    const payload: AccessRoleListPageResponse = accessRoleListPageResponseSchema.parse(response.json());
    expect(payload.detail).toBe('list');
    expect(payload.pagination).toEqual({
      page: 1,
      perPage: 1,
      totalItems: 2,
      totalPages: 2,
    });
    expect(payload.roles.map((role: AccessRoleSummary): string => role.name)).toEqual(['Beta Operator']);
  });

  it('lists groups through the paginated list contract with search and sorting', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await seedGroup(harness, {
      id: 'grp_alpha_operators',
      name: 'Alpha Operators',
      organizationId: installPayload.organization.id,
    });
    await seedGroup(harness, {
      id: 'grp_beta_operators',
      name: 'Beta Operators',
      organizationId: installPayload.organization.id,
    });

    const response: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'GET',
      url: `${compartmentGroupsPathname}?detail=list&search=operators&orderBy=name&sort=desc&page=1&perPage=1`,
    });

    expect(response.statusCode).toBe(200);
    const payload: AccessGroupListPageResponse = accessGroupListPageResponseSchema.parse(response.json());
    expect(payload.detail).toBe('list');
    expect(payload.pagination).toEqual({
      page: 1,
      perPage: 1,
      totalItems: 2,
      totalPages: 2,
    });
    expect(payload.groups.map((group: AccessGroupSummary): string => group.name)).toEqual(['Beta Operators']);
  });

  it('returns explicit options responses and rejects paginated params without detail=list', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const roleOptionsResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'GET',
      query: { detail: 'options' },
      url: compartmentRolesPathname,
    });
    expect(roleOptionsResponse.statusCode).toBe(200);
    const roleOptionsPayload: AccessRoleListOptionsResponse = accessRoleListOptionsResponseSchema.parse(
      roleOptionsResponse.json(),
    );
    expect(roleOptionsPayload.detail).toBe('options');

    const invalidRoleQueryResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'GET',
      query: { page: '2' },
      url: compartmentRolesPathname,
    });
    expect(invalidRoleQueryResponse.statusCode).toBe(400);

    const groupOptionsResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'GET',
      query: { detail: 'options' },
      url: compartmentGroupsPathname,
    });
    expect(groupOptionsResponse.statusCode).toBe(200);
    const groupOptionsPayload: AccessGroupListOptionsResponse = accessGroupListOptionsResponseSchema.parse(
      groupOptionsResponse.json(),
    );
    expect(groupOptionsPayload.detail).toBe('options');

    const invalidGroupQueryResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'GET',
      query: { sort: 'desc' },
      url: compartmentGroupsPathname,
    });
    expect(invalidGroupQueryResponse.statusCode).toBe(400);
  });

  it('sorts audit events through the public orderBy and sort query params', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await harness.db.insert(auditEventsTable).values([
      {
        actorEmail: 'sorter@example.com',
        actorType: 'user',
        eventType: 'organization.role.created',
        id: 'aud_sort_role_created',
        metadataJson: '{}',
        occurredAt: auditOrderingHoursAgo(3),
        organizationId: installPayload.organization.id,
        scopeType: 'organization',
        status: 'succeeded',
        targetDisplayName: 'Role created',
        targetId: 'rol_sort_role_created',
        targetType: 'role',
      },
      {
        actorEmail: 'sorter@example.com',
        actorType: 'user',
        eventType: 'organization.group.created',
        id: 'aud_sort_group_created',
        metadataJson: '{}',
        occurredAt: auditOrderingHoursAgo(2),
        organizationId: installPayload.organization.id,
        scopeType: 'organization',
        status: 'succeeded',
        targetDisplayName: 'Group created',
        targetId: 'grp_sort_group_created',
        targetType: 'group',
      },
    ]);

    const response: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'GET',
      query: {
        actor: 'sorter@example.com',
        orderBy: 'eventType',
        page: '1',
        perPage: '10',
        sort: 'asc',
      },
      url: compartmentAuditEventsPathname,
    });

    expect(response.statusCode).toBe(200);
    const payload: { events: AuditEventSummary[] } = auditEventListResponseSchema.parse(response.json());
    expect(payload.events.map((event: AuditEventSummary): string => event.id)).toEqual([
      'aud_sort_group_created',
      'aud_sort_role_created',
    ]);
  });

  it('uses stable default and status audit ordering branches', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await harness.db.insert(auditEventsTable).values([
      {
        actorEmail: 'sorter@example.com',
        actorType: 'user',
        eventType: 'organization.group.created',
        id: 'aud_default_latest',
        metadataJson: '{}',
        occurredAt: auditOrderingHoursAgo(1),
        organizationId: installPayload.organization.id,
        scopeType: 'organization',
        status: 'succeeded',
        targetDisplayName: 'Latest group',
        targetId: 'grp_default_latest',
        targetType: 'group',
      },
      {
        actorEmail: 'sorter@example.com',
        actorType: 'user',
        eventType: 'organization.group.created',
        id: 'aud_status_b',
        metadataJson: '{}',
        occurredAt: auditOrderingHoursAgo(2),
        organizationId: installPayload.organization.id,
        scopeType: 'organization',
        status: 'failed',
        targetDisplayName: 'Failed group B',
        targetId: 'grp_status_b',
        targetType: 'group',
      },
      {
        actorEmail: 'sorter@example.com',
        actorType: 'user',
        eventType: 'organization.group.created',
        id: 'aud_status_a',
        metadataJson: '{}',
        occurredAt: auditOrderingHoursAgo(2),
        organizationId: installPayload.organization.id,
        scopeType: 'organization',
        status: 'failed',
        targetDisplayName: 'Failed group A',
        targetId: 'grp_status_a',
        targetType: 'group',
      },
      {
        actorEmail: 'sorter@example.com',
        actorType: 'user',
        eventType: 'organization.group.created',
        id: 'aud_default_oldest',
        metadataJson: '{}',
        occurredAt: auditOrderingHoursAgo(3),
        organizationId: installPayload.organization.id,
        scopeType: 'organization',
        status: 'succeeded',
        targetDisplayName: 'Oldest group',
        targetId: 'grp_default_oldest',
        targetType: 'group',
      },
    ]);

    const defaultResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'GET',
      query: {
        actor: 'sorter@example.com',
        eventType: 'organization.group.created',
        page: '1',
        perPage: '10',
      },
      url: compartmentAuditEventsPathname,
    });
    expect(defaultResponse.statusCode).toBe(200);
    const defaultPayload: { events: AuditEventSummary[] } = auditEventListResponseSchema.parse(defaultResponse.json());
    expect(defaultPayload.events.map((event: AuditEventSummary): string => event.id)).toEqual([
      'aud_default_latest',
      'aud_status_b',
      'aud_status_a',
      'aud_default_oldest',
    ]);

    const statusResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'GET',
      query: {
        actor: 'sorter@example.com',
        eventType: 'organization.group.created',
        orderBy: 'status',
        page: '1',
        perPage: '10',
        sort: 'asc',
      },
      url: compartmentAuditEventsPathname,
    });
    expect(statusResponse.statusCode).toBe(200);
    const statusPayload: { events: AuditEventSummary[] } = auditEventListResponseSchema.parse(statusResponse.json());
    expect(statusPayload.events.map((event: AuditEventSummary): string => event.id)).toEqual([
      'aud_status_b',
      'aud_status_a',
      'aud_default_latest',
      'aud_default_oldest',
    ]);
  });

  it('rejects audit exports that exceed the route export limit', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await seedAuditExportLimitEvents(installPayload.organization.id);

    const exportResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'POST',
      query: { format: 'csv' },
      url: compartmentAuditEventsExportPathname,
    });

    expect(exportResponse.statusCode).toBe(413);
    expect(errorResponseSchema.parse(exportResponse.json()).error.code).toBe('audit_export_too_large');
  });

  it('hides audit events outside the effective retention window', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await seedAuditRetentionEvents(installPayload.organization.id);

    const auditEventsResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'GET',
      query: { perPage: '100' },
      url: compartmentAuditEventsPathname,
    });

    expect(auditEventsResponse.statusCode).toBe(200);
    const events: AuditEventSummary[] = auditEventListResponseSchema.parse(auditEventsResponse.json()).events;
    const eventIds: string[] = events.map((event: AuditEventSummary): string => event.id);
    expect(eventIds).toContain('aud_retention_recent');
    expect(eventIds).not.toContain('aud_retention_expired');
  });
});

function readAssignmentById(
  response: LightMyRequestResponse,
  assignmentId: string,
): AccessAssignmentSummary | undefined {
  return readAssignments(response).find((item: { id: string }): boolean => item.id === assignmentId);
}

function readAssignments(response: LightMyRequestResponse): AccessAssignmentSummary[] {
  return accessAssignmentListResponseSchema.parse(response.json()).assignments;
}

function readAuditEventTypes(events: AuditEventSummary[]): string[] {
  return events.map((event: AuditEventSummary): string => event.eventType);
}

function readUserAccessDetail(response: LightMyRequestResponse): UserAccessDetail {
  return userAccessDetailResponseSchema.parse(response.json()).access;
}

function countAuditEventType(events: readonly AuditEventSummary[], eventType: string): number {
  return events.filter((event: AuditEventSummary): boolean => event.eventType === eventType).length;
}

// Fixtures stay relative because audit reads are floored at now - auditRetentionDays.
// They share one anchor so rows meant to tie on occurredAt compare equal to the millisecond.
function auditOrderingHoursAgo(hours: number): Date {
  return new Date(auditOrderingAnchorMs - hours * hourMs);
}

async function seedAuditExportLimitEvents(organizationId: string): Promise<void> {
  await harness.db.execute(sql`
    INSERT INTO audit_events (
      id,
      scope_type,
      organization_id,
      event_type,
      status,
      actor_type,
      target_type,
      target_id,
      metadata_json,
      occurred_at
    )
    SELECT
      'aud_export_limit_' || value,
      'organization',
      ${organizationId},
      'organization.settings.updated',
      'succeeded',
      'system',
      'organization',
      ${organizationId},
      '{}',
      now()
    FROM generate_series(1, 10001) AS seed(value)
  `);
}

async function seedAuditRetentionEvents(organizationId: string): Promise<void> {
  await harness.db.insert(auditEventsTable).values([
    {
      actorType: 'system',
      eventType: 'organization.settings.updated',
      id: 'aud_retention_expired',
      metadataJson: '{}',
      occurredAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000),
      organizationId,
      scopeType: 'organization',
      status: 'succeeded',
      targetId: organizationId,
      targetType: 'organization',
    },
    {
      actorType: 'system',
      eventType: 'organization.settings.updated',
      id: 'aud_retention_recent',
      metadataJson: '{}',
      occurredAt: new Date(Date.now() - 89 * 24 * 60 * 60 * 1000),
      organizationId,
      scopeType: 'organization',
      status: 'succeeded',
      targetId: organizationId,
      targetType: 'organization',
    },
  ]);
}
