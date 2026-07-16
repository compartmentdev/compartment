import type { LightMyRequestResponse } from 'fastify';
import {
  buildCompartmentUserBlockApiPathname,
  buildCompartmentUserApiPathname,
  type InstallResponse,
  type PermissionKey,
  type ProjectListResponse,
  type ProjectOverviewSummary,
  type ProjectSummary,
  projectListResponseSchema,
} from '@compartment/contracts';
import {
  buildOrganizationAuthorizationHeaders,
  createDeployDescriptor,
  injectDeployRequest,
  installCompartment,
} from './api-integration.harness';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RbacTransaction } from '../src/queries/rbac.query.types';
import { createApp } from '../src/app';
import type { ApiApp } from '../src/app.types';
import { deleteAccessGroupMembershipWithExecutor } from '../src/queries/rbac-groups.query';
import {
  createRbacTestHarness,
  ensureRbacTestHarness,
  findRoleIdByName,
  resetRbacTestHarness,
  seedAssignment,
  seedAuthSession,
  seedCustomRole,
  seedEnvironment,
  seedGroup,
  seedGroupMembership,
  seedOrganizationMembership,
  seedPrincipal,
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

type ProjectListItem = ProjectOverviewSummary | ProjectSummary;

interface ExactUserPermissionActorInput {
  organizationId: string;
  permissionKey: PermissionKey;
  principalId: string;
  roleId: string;
  sessionToken: string;
}

const harness: RbacTestHarness = createRbacTestHarness('api_rbac_authorization_integration');
const app: ApiApp = createApp({ config: harness.apiConfig, pool: harness.pool });

describe('rbac authorization integration', (): void => {
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

  it('gates org-scoped user and role admin routes by the assigned permissions', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    await seedPrincipal(harness, { email: 'user-reader@example.com', id: 'prn_user_reader', passwordHash: 'hashed' });
    await seedOrganizationMembership(harness, {
      id: 'mem_user_reader',
      organizationId: installPayload.organization.id,
      principalId: 'prn_user_reader',
    });
    await seedAuthSession(harness, {
      organizationId: installPayload.organization.id,
      principalId: 'prn_user_reader',
      sessionId: 'ses_user_reader',
      sessionToken: 'user-reader-session',
    });
    await seedCustomRole(harness, {
      id: 'rol_user_reader',
      name: 'User Reader',
      organizationId: installPayload.organization.id,
      permissionKeys: ['organization.user.read'],
    });
    await seedAssignment(harness, {
      id: 'asg_user_reader',
      organizationId: installPayload.organization.id,
      roleId: 'rol_user_reader',
      scopeId: installPayload.organization.id,
      scopeType: 'organization',
      subjectId: 'prn_user_reader',
      subjectType: 'principal',
    });

    const usersResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders('user-reader-session'),
      method: 'GET',
      url: '/v1/users',
    });
    const rolesResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders('user-reader-session'),
      method: 'GET',
      url: '/v1/roles',
    });
    const inviteResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders('user-reader-session'),
      method: 'POST',
      payload: { email: 'invited@example.com' },
      url: '/v1/users',
    });

    expect(usersResponse.statusCode).toBe(200);
    expect(rolesResponse.statusCode).toBe(403);
    expect(inviteResponse.statusCode).toBe(403);
  });

  it('gates each user mutation route by its split permission', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const organizationId: string = installPayload.organization.id;
    await seedOrganizationUser(organizationId, 'prn_block_target', 'block-target@example.com');
    await seedOrganizationUser(organizationId, 'prn_remove_target', 'remove-target@example.com');
    await seedOrganizationUser(organizationId, 'prn_reset_target', 'reset-target@example.com');
    await seedExactUserPermissionActor({
      organizationId,
      permissionKey: 'organization.user.invite',
      principalId: 'prn_invite_actor',
      roleId: 'rol_invite_actor',
      sessionToken: 'invite-actor-session',
    });
    await seedExactUserPermissionActor({
      organizationId,
      permissionKey: 'organization.user.block',
      principalId: 'prn_block_actor',
      roleId: 'rol_block_actor',
      sessionToken: 'block-actor-session',
    });
    await seedExactUserPermissionActor({
      organizationId,
      permissionKey: 'organization.user.remove',
      principalId: 'prn_remove_actor',
      roleId: 'rol_remove_actor',
      sessionToken: 'remove-actor-session',
    });
    await seedExactUserPermissionActor({
      organizationId,
      permissionKey: 'organization.user.credentials.reset',
      principalId: 'prn_reset_actor',
      roleId: 'rol_reset_actor',
      sessionToken: 'reset-actor-session',
    });

    expect(await requestInvite('invite-actor-session', 'invited-by-invite@example.com')).toBe(200);
    expect(await requestBlock('invite-actor-session', 'block-target@example.com')).toBe(403);
    expect(await requestRemove('invite-actor-session', 'remove-target@example.com')).toBe(403);
    expect(await requestReset('invite-actor-session', 'reset-target@example.com')).toBe(403);

    expect(await requestInvite('block-actor-session', 'invited-by-block@example.com')).toBe(403);
    expect(await requestBlock('block-actor-session', 'block-target@example.com')).toBe(200);
    expect(await requestRemove('block-actor-session', 'remove-target@example.com')).toBe(403);
    expect(await requestReset('block-actor-session', 'reset-target@example.com')).toBe(403);

    expect(await requestInvite('remove-actor-session', 'invited-by-remove@example.com')).toBe(403);
    expect(await requestBlock('remove-actor-session', 'reset-target@example.com')).toBe(403);
    expect(await requestRemove('remove-actor-session', 'remove-target@example.com')).toBe(200);
    expect(await requestReset('remove-actor-session', 'reset-target@example.com')).toBe(403);

    expect(await requestInvite('reset-actor-session', 'invited-by-reset@example.com')).toBe(403);
    expect(await requestBlock('reset-actor-session', 'reset-target@example.com')).toBe(403);
    expect(await requestRemove('reset-actor-session', 'reset-target@example.com')).toBe(403);
    expect(await requestReset('reset-actor-session', 'reset-target@example.com')).toBe(409);
  });

  it('updates project visibility on the next request when group membership changes', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await seedProject(harness, {
      id: 'prj_123',
      name: 'billing',
      organizationId: installPayload.organization.id,
    });
    await seedProject(harness, {
      id: 'prj_456',
      name: 'ops',
      organizationId: installPayload.organization.id,
    });
    await seedPrincipal(harness, { email: 'viewer@example.com', id: 'prn_viewer', passwordHash: 'hashed' });
    await seedOrganizationMembership(harness, {
      id: 'mem_viewer',
      organizationId: installPayload.organization.id,
      principalId: 'prn_viewer',
    });
    await seedAuthSession(harness, {
      organizationId: installPayload.organization.id,
      principalId: 'prn_viewer',
      sessionId: 'ses_viewer',
      sessionToken: 'viewer-session',
    });
    await seedGroup(harness, {
      id: 'grp_123',
      name: 'Billing Viewers',
      organizationId: installPayload.organization.id,
    });
    await seedAssignment(harness, {
      id: 'asg_group_viewer',
      organizationId: installPayload.organization.id,
      roleId: await findRoleIdByName(harness, installPayload.organization.id, 'viewer'),
      scopeId: 'prj_123',
      scopeType: 'project',
      subjectId: 'grp_123',
      subjectType: 'group',
    });

    expect(await readProjectNames('viewer-session')).toEqual([]);

    await seedGroupMembership(harness, { groupId: 'grp_123', id: 'gmb_123', principalId: 'prn_viewer' });
    expect(await readProjectNames('viewer-session')).toEqual(['billing']);

    await harness.db.transaction(async (tx: RbacTransaction): Promise<void> => {
      await deleteAccessGroupMembershipWithExecutor(tx, 'grp_123', 'prn_viewer');
    });
    expect(await readProjectNames('viewer-session')).toEqual([]);
  });

  it('enforces env-scoped readonly access, deploy transitions, variable readback requirements, and block revocation', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await seedProject(harness, {
      id: 'prj_123',
      name: 'billing',
      organizationId: installPayload.organization.id,
    });
    await seedEnvironment(harness, { id: 'env_prod', name: 'production', projectId: 'prj_123' });
    await seedEnvironment(harness, { id: 'env_stage', name: 'staging', projectId: 'prj_123' });
    await seedPrincipal(harness, { email: 'operator@example.com', id: 'prn_operator', passwordHash: 'hashed' });
    await seedOrganizationMembership(harness, {
      id: 'mem_operator',
      organizationId: installPayload.organization.id,
      principalId: 'prn_operator',
    });
    await seedAuthSession(harness, {
      organizationId: installPayload.organization.id,
      principalId: 'prn_operator',
      sessionId: 'ses_operator',
      sessionToken: 'operator-session',
    });
    await seedAssignment(harness, {
      id: 'asg_readonly_prod',
      organizationId: installPayload.organization.id,
      roleId: await findRoleIdByName(harness, installPayload.organization.id, 'readonly'),
      scopeId: 'env_prod',
      scopeType: 'environment',
      subjectId: 'prn_operator',
      subjectType: 'principal',
    });

    expect(
      (
        await app.inject({
          headers: buildOrganizationAuthorizationHeaders('operator-session'),
          method: 'GET',
          url: '/v1/variables?projectName=billing&environmentName=production',
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          headers: buildOrganizationAuthorizationHeaders('operator-session'),
          method: 'GET',
          url: '/v1/variables?projectName=billing&environmentName=staging',
        })
      ).statusCode,
    ).toBe(403);

    expect(
      (
        await injectDeployRequest(app, 'operator-session', 'acme-dev', {
          descriptor: createDeployDescriptor('billing'),
          environmentName: 'production',
        })
      ).statusCode,
    ).toBe(403);

    await seedCustomRole(harness, {
      id: 'rol_deployer',
      name: 'Environment Deployer',
      organizationId: installPayload.organization.id,
      permissionKeys: ['deployment.create'],
    });
    await seedAssignment(harness, {
      id: 'asg_deployer',
      organizationId: installPayload.organization.id,
      roleId: 'rol_deployer',
      scopeId: 'env_prod',
      scopeType: 'environment',
      subjectId: 'prn_operator',
      subjectType: 'principal',
    });
    expect(
      (
        await injectDeployRequest(app, 'operator-session', 'acme-dev', {
          descriptor: createDeployDescriptor('billing'),
          environmentName: 'production',
        })
      ).statusCode,
    ).toBe(200);

    await seedCustomRole(harness, {
      id: 'rol_var_write',
      name: 'Variable Writer',
      organizationId: installPayload.organization.id,
      permissionKeys: ['variable.write'],
    });
    await seedAssignment(harness, {
      id: 'asg_var_write',
      organizationId: installPayload.organization.id,
      roleId: 'rol_var_write',
      scopeId: 'env_prod',
      scopeType: 'environment',
      subjectId: 'prn_operator',
      subjectType: 'principal',
    });
    expect(await setVariableStatus('operator-session')).toBe(403);

    await seedCustomRole(harness, {
      id: 'rol_var_read',
      name: 'Variable Readback',
      organizationId: installPayload.organization.id,
      permissionKeys: ['variable.value.read'],
    });
    await seedAssignment(harness, {
      id: 'asg_var_read',
      organizationId: installPayload.organization.id,
      roleId: 'rol_var_read',
      scopeId: 'env_prod',
      scopeType: 'environment',
      subjectId: 'prn_operator',
      subjectType: 'principal',
    });
    expect(await setVariableStatus('operator-session')).toBe(200);

    expect(
      (
        await app.inject({
          headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
          method: 'POST',
          url: buildCompartmentUserBlockApiPathname('operator@example.com'),
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          headers: buildOrganizationAuthorizationHeaders('operator-session'),
          method: 'GET',
          url: '/v1/projects',
        })
      ).statusCode,
    ).toBe(401);
  });
});

async function seedOrganizationUser(organizationId: string, principalId: string, email: string): Promise<void> {
  await seedPrincipal(harness, { email, id: principalId, passwordHash: 'hashed' });
  await seedOrganizationMembership(harness, {
    id: `mem_${principalId}`,
    organizationId,
    principalId,
  });
}

async function seedExactUserPermissionActor(input: ExactUserPermissionActorInput): Promise<void> {
  await seedOrganizationUser(input.organizationId, input.principalId, `${input.principalId}@example.com`);
  await seedAuthSession(harness, {
    organizationId: input.organizationId,
    principalId: input.principalId,
    sessionId: `ses_${input.principalId}`,
    sessionToken: input.sessionToken,
  });
  await seedCustomRole(harness, {
    id: input.roleId,
    name: input.roleId,
    organizationId: input.organizationId,
    permissionKeys: [input.permissionKey],
  });
  await seedAssignment(harness, {
    id: `asg_${input.principalId}`,
    organizationId: input.organizationId,
    roleId: input.roleId,
    scopeId: input.organizationId,
    scopeType: 'organization',
    subjectId: input.principalId,
    subjectType: 'principal',
  });
}

async function requestInvite(sessionToken: string, email: string): Promise<number> {
  return (
    await app.inject({
      headers: buildOrganizationAuthorizationHeaders(sessionToken),
      method: 'POST',
      payload: { email },
      url: '/v1/users',
    })
  ).statusCode;
}

async function requestBlock(sessionToken: string, email: string): Promise<number> {
  return (
    await app.inject({
      headers: buildOrganizationAuthorizationHeaders(sessionToken),
      method: 'POST',
      url: buildCompartmentUserBlockApiPathname(email),
    })
  ).statusCode;
}

async function requestRemove(sessionToken: string, email: string): Promise<number> {
  return (
    await app.inject({
      headers: buildOrganizationAuthorizationHeaders(sessionToken),
      method: 'DELETE',
      url: buildCompartmentUserApiPathname(email),
    })
  ).statusCode;
}

async function requestReset(sessionToken: string, email: string): Promise<number> {
  return (
    await app.inject({
      headers: buildOrganizationAuthorizationHeaders(sessionToken),
      method: 'POST',
      url: buildUserPasswordResetApiPathname(email),
    })
  ).statusCode;
}

function buildUserPasswordResetApiPathname(email: string): string {
  return `${buildCompartmentUserApiPathname(email)}/password-reset`;
}

async function readProjectNames(sessionToken: string): Promise<string[]> {
  const response: LightMyRequestResponse = await app.inject({
    headers: buildOrganizationAuthorizationHeaders(sessionToken),
    method: 'GET',
    url: '/v1/projects',
  });
  if (response.statusCode !== 200) {
    throw new Error(`Expected project list success, got ${response.statusCode.toString()}.`);
  }

  const payload: ProjectListResponse = projectListResponseSchema.parse(response.json());
  if (payload.detail === 'status') {
    throw new Error('Expected summary or overview project list response.');
  }

  return payload.projects.map((project: ProjectListItem): string => project.name);
}

async function setVariableStatus(sessionToken: string): Promise<number> {
  return (
    await app.inject({
      headers: buildOrganizationAuthorizationHeaders(sessionToken),
      method: 'POST',
      payload: {
        environmentName: 'production',
        keyName: 'LOG_LEVEL',
        projectName: 'billing',
        value: 'info',
      },
      url: '/v1/variables',
    })
  ).statusCode;
}
