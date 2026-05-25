import type { LightMyRequestResponse } from 'fastify';
import {
  buildDefaultSsoOidcIdentityVerificationConfig,
  buildCompartmentUserBlockApiPathname,
  buildCompartmentUserApiPathname,
  buildDisabledSsoOidcProvisioningPolicy,
  compartmentAuthSettingsPathname,
  compartmentGroupMembersPathnameSuffix,
  compartmentAssignmentsPathname,
  compartmentGroupsPathname,
  compartmentRolesPathname,
  compartmentSsoOidcProvidersPathname,
  errorResponseSchema,
  listCompartmentRolePermissions,
  type PermissionKey,
} from '@compartment/contracts';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import type { ApiApp } from '../src/app.types';
import {
  accessAssignments,
  accessGroupMemberships,
  accessRolePermissions,
  accessRoles,
  authSessions,
  organizationMemberships,
  organizations,
  ssoOidcIdentities,
  ssoOidcProviders,
} from '../src/db/schema';
import { hashToken } from '../src/lib/tokens';
import { buildOrganizationAuthorizationHeaders } from './api-integration.harness';
import {
  createRbacTestHarness,
  ensureRbacTestHarness,
  resetRbacTestHarness,
  seedAssignment,
  seedCustomRole,
  seedGroup,
  seedGroupMembership,
  seedMemberSession,
  seedOrganization,
  seedOrganizationMembership,
  seedPrincipal,
  type RbacTestHarness,
} from './rbac-test.fixtures';

interface AppAccessEdgeServiceModule {
  invalidateEdgeAppAccessSessions: () => Promise<void>;
  synchronizeEdgeAppAccessState: () => Promise<void>;
}

interface SoleGroupAdminFixture {
  sessionToken: string;
}

vi.mock(
  '../src/services/app-access-edge.service',
  (): AppAccessEdgeServiceModule => ({
    invalidateEdgeAppAccessSessions: async (): Promise<void> => await Promise.resolve(),
    synchronizeEdgeAppAccessState: async (): Promise<void> => await Promise.resolve(),
  }),
);

const organizationId: string = 'org_rbac_invariant';
const adminPrincipalId: string = 'prn_rbac_admin';
const adminEmail: string = 'admin@example.com';
const adminGroupId: string = 'grp_rbac_admins';
const adminRoleId: string = 'rol_rbac_admin';
const adminAssignmentId: string = 'asg_rbac_group_admin';
const operatorPrincipalId: string = 'prn_rbac_operator';
const operatorRoleId: string = 'rol_rbac_user_operator';
const operatorEmail: string = 'operator@example.com';
const roleManagerPrincipalId: string = 'prn_rbac_role_manager';
const roleManagerRoleId: string = 'rol_rbac_role_manager';
const roleManagerEmail: string = 'role-manager@example.com';
const roleManagerSessionToken: string = 'rbac-invariant-role-manager-session-token';
const targetGroupId: string = 'grp_rbac_target';
const deployRoleId: string = 'rol_rbac_deploy';
const sessionToken: string = 'rbac-invariant-session-token';
const ssoSessionToken: string = 'rbac-invariant-sso-session-token';
const ssoProviderId: string = 'sop_rbac_admin';
const operatorSessionToken: string = 'rbac-invariant-operator-session-token';
const harness: RbacTestHarness = createRbacTestHarness('api_rbac_invariants_integration');
const app: ApiApp = createApp({ config: harness.apiConfig, pool: harness.pool });

describe('rbac admin invariants', (): void => {
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

  it('rejects removing the only active admin through group membership deletion', async (): Promise<void> => {
    const fixture: SoleGroupAdminFixture = await seedSoleGroupAdminFixture();

    const response: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(fixture.sessionToken),
      method: 'DELETE',
      url: `${compartmentGroupsPathname}/${adminGroupId}${compartmentGroupMembersPathnameSuffix}/${encodeURIComponent(adminEmail)}`,
    });

    expectLastAdminConflict(response);
    await expectGroupMembershipExists('gmb_rbac_admin');
    await expectAdminCanReadRoles(fixture.sessionToken);
  });

  it('rejects removing the only active admin through group deletion', async (): Promise<void> => {
    const fixture: SoleGroupAdminFixture = await seedSoleGroupAdminFixture();

    const response: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(fixture.sessionToken),
      method: 'DELETE',
      url: `${compartmentGroupsPathname}/${adminGroupId}`,
    });

    expectLastAdminConflict(response);
    await expectGroupMembershipExists('gmb_rbac_admin');
    await expectAssignmentExists(adminAssignmentId);
    await expectAdminCanReadRoles(fixture.sessionToken);
  });

  it('does not count invited or blocked principals as the active admin path', async (): Promise<void> => {
    const fixture: SoleGroupAdminFixture = await seedSoleGroupAdminFixture();
    await seedInactiveAdminPaths();

    const response: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(fixture.sessionToken),
      method: 'DELETE',
      url: `${compartmentGroupsPathname}/${adminGroupId}`,
    });

    expectLastAdminConflict(response);
    await expectGroupMembershipExists('gmb_rbac_admin');
    await expectAdminCanReadRoles(fixture.sessionToken);
  });

  it('rejects disabling local passwords when the only admin has no SSO identity', async (): Promise<void> => {
    const fixture: SoleGroupAdminFixture = await seedSoleGroupAdminFixture();
    await seedSsoProvider(ssoProviderId);

    const response: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(fixture.sessionToken),
      method: 'PATCH',
      payload: {
        localPasswordEnabled: false,
      },
      url: compartmentAuthSettingsPathname,
    });

    expectLastAdminConflict(response);
    await expectLocalPasswordEnabled(true);
    await expectAdminCanReadRoles(fixture.sessionToken);
  });

  it('rejects disabling local passwords when no SSO provider remains', async (): Promise<void> => {
    const fixture: SoleGroupAdminFixture = await seedSoleGroupAdminFixture();

    const response: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(fixture.sessionToken),
      method: 'PATCH',
      payload: {
        localPasswordEnabled: false,
      },
      url: compartmentAuthSettingsPathname,
    });

    expectLoginMethodRequiredConflict(response);
    await expectLocalPasswordEnabled(true);
    await expectAdminCanReadRoles(fixture.sessionToken);
  });

  it('rejects deleting the SSO provider behind the only active admin path', async (): Promise<void> => {
    await seedSsoOnlyDirectAdminFixture();

    const response: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(ssoSessionToken),
      method: 'DELETE',
      url: `${compartmentSsoOidcProvidersPathname}/${ssoProviderId}`,
    });

    expectLastAdminConflict(response);
    await expectSsoProviderKey(ssoProviderId, 'single-sign-on');
    await expectSsoIdentityExists('soi_rbac_admin');
    await expectAdminCanReadRoles(ssoSessionToken);
  });

  it('rejects resetting the SSO identity namespace behind the only active admin path', async (): Promise<void> => {
    await seedSsoOnlyDirectAdminFixture();

    const response: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(ssoSessionToken),
      method: 'PATCH',
      payload: {
        clientId: 'client_changed',
        clientSecret: 'secret_changed',
      },
      url: `${compartmentSsoOidcProvidersPathname}/${ssoProviderId}`,
    });

    expectLastAdminConflict(response);
    await expectSsoProviderKey(ssoProviderId, 'single-sign-on');
    await expectSsoIdentityExists('soi_rbac_admin');
    await expectAdminCanReadRoles(ssoSessionToken);
  });

  it('rejects removing the only active admin through role permission update', async (): Promise<void> => {
    const fixture: SoleGroupAdminFixture = await seedSoleGroupAdminFixture();

    const response: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(fixture.sessionToken),
      method: 'PATCH',
      payload: {
        permissionKeys: ['project.read'],
      },
      url: `${compartmentRolesPathname}/${adminRoleId}`,
    });

    expectLastAdminConflict(response);
    expect(await readRolePermissionKeys(adminRoleId)).toEqual(
      [...listCompartmentRolePermissions('admin')].sort(compareStrings),
    );
    await expectAdminCanReadRoles(fixture.sessionToken);
  });

  it('rejects removing the only active admin through role deletion', async (): Promise<void> => {
    const fixture: SoleGroupAdminFixture = await seedSoleGroupAdminFixture();

    const response: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(fixture.sessionToken),
      method: 'DELETE',
      url: `${compartmentRolesPathname}/${adminRoleId}`,
    });

    expectLastAdminConflict(response);
    await expectRoleExists(adminRoleId);
    await expectAssignmentExists(adminAssignmentId);
    await expectAdminCanReadRoles(fixture.sessionToken);
  });

  it('rejects deleting the only active admin assignment by a different role manager', async (): Promise<void> => {
    await seedSoleGroupAdminFixture();
    const managerSessionToken: string = await seedRoleManagerFixture();

    const response: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(managerSessionToken),
      method: 'DELETE',
      url: `${compartmentAssignmentsPathname}/${adminAssignmentId}`,
    });

    expectLastAdminConflict(response);
    await expectAssignmentExists(adminAssignmentId);
    await expectAdminCanReadRoles(sessionToken);
  });

  it('rejects blocking or removing the only active group-backed admin', async (): Promise<void> => {
    await seedSoleGroupAdminFixture();
    const blockOperatorSessionToken: string = await seedUserOperatorFixture();
    const blockResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(blockOperatorSessionToken),
      method: 'POST',
      url: buildCompartmentUserBlockApiPathname(adminEmail),
    });
    expectLastAdminConflict(blockResponse);
    await expectMembershipAllowed(adminPrincipalId);
    await expectAdminCanReadRoles(sessionToken);

    await resetRbacTestHarness(harness);
    await seedSoleGroupAdminFixture();
    const removeOperatorSessionToken: string = await seedUserOperatorFixture();
    const removeResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(removeOperatorSessionToken),
      method: 'DELETE',
      url: buildCompartmentUserApiPathname(adminEmail),
    });
    expectLastAdminConflict(removeResponse);
    await expectMembershipAllowed(adminPrincipalId);
    await expectAdminCanReadRoles(sessionToken);
  });

  it('rejects role managers granting permissions above their own effective access', async (): Promise<void> => {
    await seedSoleGroupAdminFixture();
    const managerSessionToken: string = await seedRoleManagerFixture();

    const roleCreateResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(managerSessionToken),
      method: 'POST',
      payload: {
        name: 'deploy-granter',
        permissionKeys: ['deployment.create'],
      },
      url: compartmentRolesPathname,
    });
    expect(roleCreateResponse.statusCode).toBe(403);
    await expectNoRoleNamed('deploy-granter');

    const assignmentCreateResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(managerSessionToken),
      method: 'POST',
      payload: {
        roleId: deployRoleId,
        scope: { scopeType: 'organization' },
        subject: { groupId: targetGroupId, subjectType: 'group' },
      },
      url: compartmentAssignmentsPathname,
    });
    expect(assignmentCreateResponse.statusCode).toBe(403);
    await expectGroupAssignmentCount(targetGroupId, deployRoleId, 0);
  });

  it('rejects role manager updates that add permissions above their own effective access', async (): Promise<void> => {
    await seedSoleGroupAdminFixture();
    const managerSessionToken: string = await seedRoleManagerFixture();
    await seedCustomRole(harness, {
      id: 'rol_rbac_readable',
      name: 'readable-role',
      organizationId,
      permissionKeys: ['organization.role.manage'],
    });

    const response: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(managerSessionToken),
      method: 'PATCH',
      payload: {
        permissionKeys: ['organization.role.manage', 'deployment.create'],
      },
      url: `${compartmentRolesPathname}/rol_rbac_readable`,
    });

    expect(response.statusCode).toBe(403);
    expect(await readRolePermissionKeys('rol_rbac_readable')).toEqual(['organization.role.manage']);
  });

  it('rejects adding a member to a group whose assigned roles exceed the actor access', async (): Promise<void> => {
    await seedSoleGroupAdminFixture();
    const managerSessionToken: string = await seedGroupManagerFixture();
    await seedCustomRole(harness, {
      id: deployRoleId,
      name: 'deploy-role',
      organizationId,
      permissionKeys: ['deployment.create'],
    });
    await seedGroup(harness, {
      id: targetGroupId,
      name: 'target-group',
      organizationId,
    });
    await seedAssignment(harness, {
      id: 'asg_rbac_target_group_deploy',
      organizationId,
      roleId: deployRoleId,
      scopeId: organizationId,
      scopeType: 'organization',
      subjectId: targetGroupId,
      subjectType: 'group',
    });
    await seedMemberSession(harness, {
      email: 'target-user@example.com',
      organizationId,
      principalId: 'prn_rbac_target_user',
      sessionToken: 'rbac-target-user-session-token',
    });

    const response: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(managerSessionToken),
      method: 'POST',
      payload: { email: 'target-user@example.com' },
      url: `${compartmentGroupsPathname}/${targetGroupId}${compartmentGroupMembersPathnameSuffix}`,
    });

    expect(response.statusCode).toBe(403);
    await expectGroupMemberCount(targetGroupId, 0);
  });
});

async function seedSoleGroupAdminFixture(): Promise<SoleGroupAdminFixture> {
  await seedOrganization(harness, { id: organizationId });
  await seedMemberSession(harness, {
    email: adminEmail,
    organizationId,
    principalId: adminPrincipalId,
    sessionToken,
  });
  await seedCustomRole(harness, {
    id: adminRoleId,
    name: 'custom-admin',
    organizationId,
    permissionKeys: listCompartmentRolePermissions('admin'),
  });
  await seedGroup(harness, {
    id: adminGroupId,
    name: 'custom-admins',
    organizationId,
  });
  await seedGroupMembership(harness, {
    groupId: adminGroupId,
    id: 'gmb_rbac_admin',
    principalId: adminPrincipalId,
  });
  await seedAssignment(harness, {
    id: 'asg_rbac_group_admin',
    organizationId,
    roleId: adminRoleId,
    scopeId: organizationId,
    scopeType: 'organization',
    subjectId: adminGroupId,
    subjectType: 'group',
  });

  return { sessionToken };
}

async function seedInactiveAdminPaths(): Promise<void> {
  await seedPrincipal(harness, { email: 'invited-admin@example.com', id: 'prn_rbac_invited_admin' });
  await seedOrganizationMembership(harness, {
    id: 'mem_rbac_invited_admin',
    organizationId,
    principalId: 'prn_rbac_invited_admin',
  });
  await seedAssignment(harness, {
    id: 'asg_rbac_invited_admin',
    organizationId,
    roleId: adminRoleId,
    scopeId: organizationId,
    scopeType: 'organization',
    subjectId: 'prn_rbac_invited_admin',
    subjectType: 'principal',
  });
  await seedPrincipal(harness, {
    email: 'blocked-admin@example.com',
    id: 'prn_rbac_blocked_admin',
    passwordHash: 'hashed',
  });
  await seedOrganizationMembership(harness, {
    blockedAt: new Date('2026-05-05T10:00:00.000Z'),
    id: 'mem_rbac_blocked_admin',
    organizationId,
    principalId: 'prn_rbac_blocked_admin',
  });
  await seedAssignment(harness, {
    id: 'asg_rbac_blocked_admin',
    organizationId,
    roleId: adminRoleId,
    scopeId: organizationId,
    scopeType: 'organization',
    subjectId: 'prn_rbac_blocked_admin',
    subjectType: 'principal',
  });
}

async function seedSsoOnlyDirectAdminFixture(): Promise<void> {
  await seedOrganization(harness, { id: organizationId });
  await seedPrincipal(harness, { email: adminEmail, id: adminPrincipalId, passwordHash: null });
  await seedOrganizationMembership(harness, {
    id: 'mem_rbac_sso_admin',
    organizationId,
    principalId: adminPrincipalId,
  });
  await seedCustomRole(harness, {
    id: adminRoleId,
    name: 'custom-admin',
    organizationId,
    permissionKeys: listCompartmentRolePermissions('admin'),
  });
  await seedAssignment(harness, {
    id: 'asg_rbac_sso_admin',
    organizationId,
    roleId: adminRoleId,
    scopeId: organizationId,
    scopeType: 'organization',
    subjectId: adminPrincipalId,
    subjectType: 'principal',
  });
  await seedSsoProvider(ssoProviderId);
  await harness.db.insert(ssoOidcIdentities).values({
    id: 'soi_rbac_admin',
    lastLoginAt: new Date('2026-05-05T10:00:00.000Z'),
    principalId: adminPrincipalId,
    providerId: ssoProviderId,
    subject: 'admin-subject',
  });
  await harness.db.insert(authSessions).values({
    authMethodKind: 'oidc',
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    id: 'ses_rbac_sso_admin',
    oidcProviderId: ssoProviderId,
    organizationId,
    principalId: adminPrincipalId,
    tokenHash: hashToken(ssoSessionToken, harness.apiConfig.sessionSecret),
  });
}

async function seedSsoProvider(providerId: string): Promise<void> {
  await harness.db.insert(ssoOidcProviders).values({
    buttonText: 'Login with Single sign-on',
    clientId: 'client_123',
    clientSecretCiphertext: 'ciphertext',
    clientSecretEncryptionKeyId: 'key-id',
    displayName: 'Single sign-on',
    id: providerId,
    identityVerificationJson: JSON.stringify(buildDefaultSsoOidcIdentityVerificationConfig()),
    issuerUrl: 'https://idp.example.com',
    key: 'single-sign-on',
    organizationId,
    preset: 'generic',
    provisioningPolicyJson: JSON.stringify(buildDisabledSsoOidcProvisioningPolicy()),
    scope: 'openid email profile',
    updatedAt: new Date('2026-05-05T10:00:00.000Z'),
  });
}

async function seedUserOperatorFixture(): Promise<string> {
  await seedMemberSession(harness, {
    email: operatorEmail,
    organizationId,
    principalId: operatorPrincipalId,
    sessionToken: operatorSessionToken,
  });
  await seedCustomRole(harness, {
    id: operatorRoleId,
    name: 'user-operator',
    organizationId,
    permissionKeys: ['organization.user.block', 'organization.user.remove'],
  });
  await seedAssignment(harness, {
    id: 'asg_rbac_user_operator',
    organizationId,
    roleId: operatorRoleId,
    scopeId: organizationId,
    scopeType: 'organization',
    subjectId: operatorPrincipalId,
    subjectType: 'principal',
  });

  return operatorSessionToken;
}

async function seedRoleManagerFixture(): Promise<string> {
  await seedMemberSession(harness, {
    email: roleManagerEmail,
    organizationId,
    principalId: roleManagerPrincipalId,
    sessionToken: roleManagerSessionToken,
  });
  await seedCustomRole(harness, {
    id: roleManagerRoleId,
    name: 'role-manager',
    organizationId,
    permissionKeys: ['organization.role.manage'],
  });
  await seedAssignment(harness, {
    id: 'asg_rbac_role_manager',
    organizationId,
    roleId: roleManagerRoleId,
    scopeId: organizationId,
    scopeType: 'organization',
    subjectId: roleManagerPrincipalId,
    subjectType: 'principal',
  });
  await seedCustomRole(harness, {
    id: deployRoleId,
    name: 'deploy-role',
    organizationId,
    permissionKeys: ['deployment.create'],
  });
  await seedGroup(harness, {
    id: targetGroupId,
    name: 'target-group',
    organizationId,
  });

  return roleManagerSessionToken;
}

async function seedGroupManagerFixture(): Promise<string> {
  await seedMemberSession(harness, {
    email: 'group-manager@example.com',
    organizationId,
    principalId: 'prn_rbac_group_manager',
    sessionToken: 'rbac-invariant-group-manager-session-token',
  });
  await seedCustomRole(harness, {
    id: 'rol_rbac_group_manager',
    name: 'group-manager',
    organizationId,
    permissionKeys: ['organization.group.manage'],
  });
  await seedAssignment(harness, {
    id: 'asg_rbac_group_manager',
    organizationId,
    roleId: 'rol_rbac_group_manager',
    scopeId: organizationId,
    scopeType: 'organization',
    subjectId: 'prn_rbac_group_manager',
    subjectType: 'principal',
  });

  return 'rbac-invariant-group-manager-session-token';
}

function expectLastAdminConflict(response: LightMyRequestResponse): void {
  expect(response.statusCode).toBe(409);
  expect(errorResponseSchema.parse(response.json()).error.code).toBe('last_organization_admin');
}

function expectLoginMethodRequiredConflict(response: LightMyRequestResponse): void {
  expect(response.statusCode).toBe(409);
  expect(errorResponseSchema.parse(response.json()).error.code).toBe('login_method_required');
}

async function expectAdminCanReadRoles(token: string): Promise<void> {
  const response: LightMyRequestResponse = await app.inject({
    headers: buildOrganizationAuthorizationHeaders(token),
    method: 'GET',
    url: compartmentRolesPathname,
  });
  expect(response.statusCode).toBe(200);
}

async function expectGroupMembershipExists(groupMembershipId: string): Promise<void> {
  const rows: { id: string }[] = await harness.db
    .select({ id: accessGroupMemberships.id })
    .from(accessGroupMemberships)
    .where(eq(accessGroupMemberships.id, groupMembershipId));
  expect(rows).toEqual([{ id: groupMembershipId }]);
}

async function expectGroupMemberCount(groupId: string, expectedCount: number): Promise<void> {
  const rows: { id: string }[] = await harness.db
    .select({ id: accessGroupMemberships.id })
    .from(accessGroupMemberships)
    .where(eq(accessGroupMemberships.groupId, groupId));
  expect(rows).toHaveLength(expectedCount);
}

async function expectGroupAssignmentCount(groupId: string, roleId: string, expectedCount: number): Promise<void> {
  const rows: { id: string }[] = await harness.db
    .select({ id: accessAssignments.id })
    .from(accessAssignments)
    .where(
      and(
        eq(accessAssignments.subjectType, 'group'),
        eq(accessAssignments.subjectId, groupId),
        eq(accessAssignments.roleId, roleId),
      ),
    );
  expect(rows).toHaveLength(expectedCount);
}

async function expectAssignmentExists(assignmentId: string): Promise<void> {
  const rows: { id: string }[] = await harness.db
    .select({ id: accessAssignments.id })
    .from(accessAssignments)
    .where(eq(accessAssignments.id, assignmentId));
  expect(rows).toEqual([{ id: assignmentId }]);
}

async function expectRoleExists(roleId: string): Promise<void> {
  const rows: { id: string }[] = await harness.db
    .select({ id: accessRoles.id })
    .from(accessRoles)
    .where(eq(accessRoles.id, roleId));
  expect(rows).toEqual([{ id: roleId }]);
}

async function expectMembershipAllowed(principalId: string): Promise<void> {
  const rows: { blockedAt: Date | null; principalId: string }[] = await harness.db
    .select({
      blockedAt: organizationMemberships.blockedAt,
      principalId: organizationMemberships.principalId,
    })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.principalId, principalId),
      ),
    );
  expect(rows).toEqual([{ blockedAt: null, principalId }]);
}

async function expectLocalPasswordEnabled(expected: boolean): Promise<void> {
  const rows: { localPasswordEnabled: boolean }[] = await harness.db
    .select({ localPasswordEnabled: organizations.localPasswordEnabled })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  expect(rows).toEqual([{ localPasswordEnabled: expected }]);
}

async function expectSsoProviderKey(providerId: string, expectedKey: string): Promise<void> {
  const rows: { key: string }[] = await harness.db
    .select({ key: ssoOidcProviders.key })
    .from(ssoOidcProviders)
    .where(eq(ssoOidcProviders.id, providerId));
  expect(rows).toEqual([{ key: expectedKey }]);
}

async function expectSsoIdentityExists(identityId: string): Promise<void> {
  const rows: { id: string }[] = await harness.db
    .select({ id: ssoOidcIdentities.id })
    .from(ssoOidcIdentities)
    .where(eq(ssoOidcIdentities.id, identityId));
  expect(rows).toEqual([{ id: identityId }]);
}

async function expectNoRoleNamed(roleName: string): Promise<void> {
  const rows: { id: string }[] = await harness.db
    .select({ id: accessRoles.id })
    .from(accessRoles)
    .where(and(eq(accessRoles.organizationId, organizationId), eq(accessRoles.name, roleName)));
  expect(rows).toEqual([]);
}

async function readRolePermissionKeys(roleId: string): Promise<PermissionKey[]> {
  const rows: { permissionKey: string }[] = await harness.db
    .select({ permissionKey: accessRolePermissions.permissionKey })
    .from(accessRolePermissions)
    .where(eq(accessRolePermissions.roleId, roleId));
  return rows
    .map((row: { permissionKey: string }): PermissionKey => row.permissionKey as PermissionKey)
    .sort(compareStrings);
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}
