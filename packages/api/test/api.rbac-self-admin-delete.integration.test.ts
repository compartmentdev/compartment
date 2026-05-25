import type { LightMyRequestResponse } from 'fastify';
import {
  type AccessAssignmentSummary,
  type AccessGroupSummary,
  type AccessRoleSummary,
  accessAssignmentListResponseSchema,
  accessAssignmentResponseSchema,
  accessGroupResponseSchema,
  accessRoleListResponseSchema,
  compartmentAssignmentsPathname,
  compartmentGroupMembersPathnameSuffix,
  compartmentGroupsPathname,
  compartmentRolesPathname,
  errorResponseSchema,
  type InstallResponse,
} from '@compartment/contracts';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import type { ApiApp } from '../src/app.types';
import { buildOrganizationAuthorizationHeaders, installCompartment } from './api-integration.harness';
import { createRbacTestHarness, type RbacTestHarness } from './rbac-test.fixtures';
import { useApiRuntimeDatabaseTestHarness } from './api-db-test.harness';

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

const harness: RbacTestHarness = createRbacTestHarness('api_rbac_self_admin_delete_integration');
const app: ApiApp = createApp({ closePool: false, config: harness.apiConfig, pool: harness.pool });

describe('rbac self admin assignment deletion', (): void => {
  useApiRuntimeDatabaseTestHarness(harness);

  afterEach((): void => {
    vi.unstubAllGlobals();
  });

  afterAll(async (): Promise<void> => {
    await app.close();
  });

  it('rejects deleting your own direct organization admin assignment', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const adminAssignment: AccessAssignmentSummary = await readCreatorAdminAssignment(installPayload.sessionToken);

    const deleteResponse: LightMyRequestResponse = await deleteAssignment(
      installPayload.sessionToken,
      adminAssignment.id,
    );

    expect(deleteResponse.statusCode).toBe(409);
    expect(errorResponseSchema.parse(deleteResponse.json()).error.code).toBe('self_admin_membership_change_forbidden');
    await expectAssignmentStillExists(installPayload.sessionToken, adminAssignment.id);
  });

  it('rejects deleting your own group-backed organization admin assignment', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const adminRole: AccessRoleSummary = await readAdminRole(installPayload.sessionToken);
    const group: AccessGroupSummary = await createAdminGroup(installPayload.sessionToken);

    await addAdminToGroup(installPayload.sessionToken, group.id);
    const groupAssignment: AccessAssignmentSummary = await createGroupAdminAssignment(
      installPayload.sessionToken,
      adminRole.id,
      group.id,
    );

    const deleteResponse: LightMyRequestResponse = await deleteAssignment(
      installPayload.sessionToken,
      groupAssignment.id,
    );

    expect(deleteResponse.statusCode).toBe(409);
    expect(errorResponseSchema.parse(deleteResponse.json()).error.code).toBe('self_admin_membership_change_forbidden');
    await expectAssignmentStillExists(installPayload.sessionToken, groupAssignment.id);
  });
});

async function readCreatorAdminAssignment(sessionToken: string): Promise<AccessAssignmentSummary> {
  const assignmentsResponse: LightMyRequestResponse = await app.inject({
    headers: buildOrganizationAuthorizationHeaders(sessionToken),
    method: 'GET',
    url: compartmentAssignmentsPathname,
  });
  expect(assignmentsResponse.statusCode).toBe(200);
  const assignment: AccessAssignmentSummary | undefined = readAssignments(assignmentsResponse).find(
    (item: AccessAssignmentSummary): boolean =>
      item.roleName === 'admin' &&
      item.scope.scopeType === 'organization' &&
      item.subject.subjectType === 'principal' &&
      item.subject.principalEmail === 'admin@example.com',
  );
  if (assignment === undefined) {
    throw new Error('Expected creator admin assignment.');
  }

  return assignment;
}

async function readAdminRole(sessionToken: string): Promise<AccessRoleSummary> {
  const rolesResponse: LightMyRequestResponse = await app.inject({
    headers: buildOrganizationAuthorizationHeaders(sessionToken),
    method: 'GET',
    url: compartmentRolesPathname,
  });
  expect(rolesResponse.statusCode).toBe(200);
  const role: AccessRoleSummary | undefined = accessRoleListResponseSchema
    .parse(rolesResponse.json())
    .roles.find((item: AccessRoleSummary): boolean => item.name === 'admin');
  if (role === undefined) {
    throw new Error('Expected admin role.');
  }

  return role;
}

async function createAdminGroup(sessionToken: string): Promise<AccessGroupSummary> {
  const groupResponse: LightMyRequestResponse = await app.inject({
    headers: buildOrganizationAuthorizationHeaders(sessionToken),
    method: 'POST',
    payload: { name: 'Admins' },
    url: compartmentGroupsPathname,
  });
  expect(groupResponse.statusCode).toBe(200);

  return accessGroupResponseSchema.parse(groupResponse.json()).group;
}

async function addAdminToGroup(sessionToken: string, groupId: string): Promise<void> {
  const addMemberResponse: LightMyRequestResponse = await app.inject({
    headers: buildOrganizationAuthorizationHeaders(sessionToken),
    method: 'POST',
    payload: { email: 'admin@example.com' },
    url: `${compartmentGroupsPathname}/${groupId}${compartmentGroupMembersPathnameSuffix}`,
  });
  expect(addMemberResponse.statusCode).toBe(200);
}

async function createGroupAdminAssignment(
  sessionToken: string,
  roleId: string,
  groupId: string,
): Promise<AccessAssignmentSummary> {
  const assignmentResponse: LightMyRequestResponse = await app.inject({
    headers: buildOrganizationAuthorizationHeaders(sessionToken),
    method: 'POST',
    payload: {
      roleId,
      scope: { scopeType: 'organization' },
      subject: {
        groupId,
        subjectType: 'group',
      },
    },
    url: compartmentAssignmentsPathname,
  });
  expect(assignmentResponse.statusCode).toBe(200);

  return accessAssignmentResponseSchema.parse(assignmentResponse.json()).assignment;
}

async function deleteAssignment(sessionToken: string, assignmentId: string): Promise<LightMyRequestResponse> {
  return await app.inject({
    headers: buildOrganizationAuthorizationHeaders(sessionToken),
    method: 'DELETE',
    url: `${compartmentAssignmentsPathname}/${assignmentId}`,
  });
}

async function expectAssignmentStillExists(sessionToken: string, assignmentId: string): Promise<void> {
  const assignmentsResponse: LightMyRequestResponse = await app.inject({
    headers: buildOrganizationAuthorizationHeaders(sessionToken),
    method: 'GET',
    url: compartmentAssignmentsPathname,
  });
  expect(assignmentsResponse.statusCode).toBe(200);
  expect(
    readAssignments(assignmentsResponse).some((item: AccessAssignmentSummary): boolean => item.id === assignmentId),
  ).toBe(true);
}

function readAssignments(response: LightMyRequestResponse): AccessAssignmentSummary[] {
  return accessAssignmentListResponseSchema.parse(response.json()).assignments;
}
