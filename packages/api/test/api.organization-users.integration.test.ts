import {
  activateResponseSchema,
  issuePasswordResetResponseSchema,
  compartmentSessionCookieName,
  errorResponseSchema,
  createOrganizationResponseSchema,
  organizationUserResponseSchema,
  removeUserResponseSchema,
  userListResponseSchema,
  inviteUserResponseSchema,
  type ActivateResponse,
  type CreateOrganizationResponse,
  type InviteUserResponse,
  type IssuePasswordResetResponse,
  type InstallResponse,
  type OrganizationSummary,
  type OrganizationUserSummary,
  type RemoveUserResponse,
  type UserListResponse,
  compartmentCsrfCookieName,
  compartmentCsrfHeaderName,
  compartmentCurrentOrganizationHeaderName,
} from '@compartment/contracts';
import type { LightMyRequestResponse } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi, type Mock, type MockInstance } from 'vitest';
import { and, count, eq } from 'drizzle-orm';
import {
  createStoredAppAccessSession as createStoredAppAccessSessionFixture,
  createOrganizationMemberSession as createOrganizationMemberSessionFixture,
  readStoredAppAccessSession as readStoredAppAccessSessionFixture,
  readStoredAuthSession as readStoredAuthSessionFixture,
  readStoredAuthSessionIdByToken as readStoredAuthSessionIdByTokenFixture,
  createStoredSsoOidcProvider as createStoredSsoOidcProviderFixture,
} from './api-auth-session-test.fixtures';
import type { ApiApp } from '../src/app.types';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';

import {
  accessGroupMemberships,
  accessGroups,
  accessAssignments,
  accessRoles,
  auditEvents,
  authSessions,
  localCredentials,
  organizationQuotaReconciliation,
  organizationMemberships,
  organizations,
  principals,
  projects,
  ssoOidcIdentities,
} from '../src/db/schema';
import { createEdgeStateUpdateFailedError } from '../src/errors/api-business-error';
import { authApiActivatePathname } from '../src/routes/auth/auth-api-paths';

import { createBrowserCsrfCookie } from '../src/services/browser-csrf-cookie.service';
import { buildRuntimePublicSettings } from '../src/services/public-hosts.service';
import {
  buildSystemAuthorizationHeaders,
  buildOrganizationAuthorizationHeaders,
  installCompartment,
  requireQueryParam,
  requireSetCookieValue,
  rollbackOpenTransaction,
  waitForConcurrentDatabaseWork,
} from './api-integration.harness';
import {
  createApiIntegrationApps,
  createApiIntegrationTestContext,
  cleanupApiIntegrationRuntime,
  cleanupApiIntegrationTempDirectory,
  configureApiRuntimeWithPublicIngress,
  resetApiIntegrationTempDirectory,
} from './api-app-test.harness';
import { useApiDatabaseTestHarness } from './api-db-test.harness';

type InvalidateEdgeAppAccessSessions = () => Promise<void>;
type SynchronizeEdgeAppAccessState = () => Promise<void>;
type ResolveDnsRecord = (hostname: string) => Promise<string[]>;
type ResolveTxtRecord = (hostname: string) => Promise<string[][]>;

interface AppAccessEdgeServiceMocks {
  invalidateEdgeAppAccessSessions: Mock<InvalidateEdgeAppAccessSessions>;
  synchronizeEdgeAppAccessState: Mock<SynchronizeEdgeAppAccessState>;
}

interface DnsPromiseMocks {
  resolve4: Mock<ResolveDnsRecord>;
  resolve6: Mock<ResolveDnsRecord>;
  resolveCname: Mock<ResolveDnsRecord>;
  resolveTxt: Mock<ResolveTxtRecord>;
}

interface PasswordResetCredentialFields {
  passwordResetOrganizationId: string | null;
  passwordResetTokenExpiresAt: Date | null;
  passwordResetTokenHash: string | null;
}

const appAccessEdgeServiceMocks: AppAccessEdgeServiceMocks = vi.hoisted(
  (): AppAccessEdgeServiceMocks => ({
    invalidateEdgeAppAccessSessions: vi.fn<InvalidateEdgeAppAccessSessions>(),
    synchronizeEdgeAppAccessState: vi.fn<SynchronizeEdgeAppAccessState>(),
  }),
);

const dnsPromiseMocks: DnsPromiseMocks = vi.hoisted(
  (): DnsPromiseMocks => ({
    resolve4: vi.fn<ResolveDnsRecord>(),
    resolve6: vi.fn<ResolveDnsRecord>(),
    resolveCname: vi.fn<ResolveDnsRecord>(),
    resolveTxt: vi.fn<ResolveTxtRecord>(),
  }),
);

vi.mock(
  '../src/services/app-access-edge.service',
  (): AppAccessEdgeServiceMocks => ({
    invalidateEdgeAppAccessSessions: appAccessEdgeServiceMocks.invalidateEdgeAppAccessSessions,
    synchronizeEdgeAppAccessState: appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState,
  }),
);

vi.mock(
  'node:dns/promises',
  (): DnsPromiseMocks => ({
    resolve4: dnsPromiseMocks.resolve4,
    resolve6: dnsPromiseMocks.resolve6,
    resolveCname: dnsPromiseMocks.resolveCname,
    resolveTxt: dnsPromiseMocks.resolveTxt,
  }),
);

const {
  apiConfig: defaultApiConfig,
  databaseUrl: apiIntegrationDatabaseUrl,
  testTempDirectory,
} = createApiIntegrationTestContext('api_integration_organization_users', 'api-integration-organization-users');
let pool!: Pool;
let db!: Database;
let app!: ApiApp;
let systemApp!: ApiApp;
let hasInitializedApiIntegrationRuntime: boolean = false;

describe('Phase 0 API integration organization users', (): void => {
  useApiDatabaseTestHarness(apiIntegrationDatabaseUrl);

  beforeEach(async (): Promise<void> => {
    appAccessEdgeServiceMocks.invalidateEdgeAppAccessSessions.mockReset();
    appAccessEdgeServiceMocks.invalidateEdgeAppAccessSessions.mockResolvedValue(undefined);
    appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState.mockReset();
    appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState.mockResolvedValue(undefined);
    dnsPromiseMocks.resolve4.mockReset();
    dnsPromiseMocks.resolve4.mockResolvedValue(['203.0.113.10']);
    dnsPromiseMocks.resolve6.mockReset();
    dnsPromiseMocks.resolve6.mockRejectedValue(new Error('No AAAA record.'));
    dnsPromiseMocks.resolveCname.mockReset();
    dnsPromiseMocks.resolveCname.mockRejectedValue(new Error('No CNAME record.'));
    dnsPromiseMocks.resolveTxt.mockReset();
    dnsPromiseMocks.resolveTxt.mockRejectedValue(new Error('No TXT record.'));
    await resetApiIntegrationTempDirectory(testTempDirectory);
    pool = createDatabasePool(apiIntegrationDatabaseUrl);
    db = createDatabase(pool);
    ({ app, systemApp } = await createApiIntegrationApps(defaultApiConfig, db, pool));
    configureApiRuntimeWithPublicIngress(defaultApiConfig, db);
    hasInitializedApiIntegrationRuntime = true;
  });
  afterAll(async (): Promise<void> => {
    await cleanupApiIntegrationTempDirectory(testTempDirectory);
  });
  afterEach(async (): Promise<void> => {
    vi.unstubAllGlobals();
    if (!hasInitializedApiIntegrationRuntime) {
      return;
    }

    hasInitializedApiIntegrationRuntime = false;
    await cleanupApiIntegrationRuntime(app, systemApp, pool);
  });
  it('creates one pending quota reconciliation row for installation and organization creation', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    expect(await db.select().from(organizationQuotaReconciliation)).toMatchObject([
      { organizationId: installPayload.organization.id, state: 'pending' },
    ]);

    const response: LightMyRequestResponse = await app.inject({
      headers: { authorization: `Bearer ${installPayload.sessionToken}` },
      method: 'POST',
      payload: { name: 'Beta Dev', slug: 'beta-dev' },
      url: '/v1/organizations',
    });
    expect(response.statusCode).toBe(200);
    const created: CreateOrganizationResponse = createOrganizationResponseSchema.parse(response.json());
    expect(
      await db
        .select()
        .from(organizationQuotaReconciliation)
        .where(eq(organizationQuotaReconciliation.organizationId, created.organization.id)),
    ).toMatchObject([{ organizationId: created.organization.id, state: 'pending' }]);
  });

  it('rejects expired password reset tokens', async (): Promise<void> => {
    await installCompartment(app);
    const issueResponse: LightMyRequestResponse = await systemApp.inject({
      headers: buildSystemAuthorizationHeaders(),
      method: 'POST',
      payload: {
        email: 'admin@example.com',
      },
      url: '/internal/system/auth/password-reset/issue',
    });
    expect(issueResponse.statusCode).toBe(200);
    const issuePayload: IssuePasswordResetResponse = issuePasswordResetResponseSchema.parse(issueResponse.json());
    const adminPrincipalId: string = (
      await db.select({ id: principals.id }).from(principals).where(eq(principals.email, 'admin@example.com')).limit(1)
    )[0]!.id;

    await db
      .update(localCredentials)
      .set({
        passwordResetTokenExpiresAt: new Date('2000-01-01T00:00:00.000Z'),
      })
      .where(eq(localCredentials.principalId, adminPrincipalId));

    const response: LightMyRequestResponse = await app.inject({
      method: 'POST',
      payload: {
        email: 'admin@example.com',
        password: 'newsupersecretpassword',
        resetToken: issuePayload.resetToken,
      },
      url: '/v1/auth/reset-password',
    });

    expect(response.statusCode).toBe(401);
    expect(errorResponseSchema.parse(response.json()).error.code).toBe('invalid_password_reset_token');
  });

  it('returns conflict when password reset issuance targets a passwordless invited user', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const inviteResponse: LightMyRequestResponse = await app.inject({
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
      method: 'POST',
      payload: {
        email: 'viewer@example.com',
      },
      url: '/v1/users',
    });
    expect(inviteResponse.statusCode).toBe(200);

    const response: LightMyRequestResponse = await systemApp.inject({
      headers: buildSystemAuthorizationHeaders(),
      method: 'POST',
      payload: {
        email: 'viewer@example.com',
      },
      url: '/internal/system/auth/password-reset/issue',
    });

    expect(response.statusCode).toBe(409);
    expect(errorResponseSchema.parse(response.json()).error.code).toBe('password_reset_not_available');
  });

  it('does not let another organization issue a reset URL for an active principal', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const adminPrincipalId: string = await readPrincipalIdByEmail('admin@example.com');
    const betaOrganization: CreateOrganizationResponse = await createOrganization(
      installPayload.sessionToken,
      'Beta Dev',
      'beta-dev',
    );
    await removePrincipalFromOrganization(adminPrincipalId, betaOrganization.organization.id);
    const credentialFieldsBeforeIssue: PasswordResetCredentialFields =
      await readPasswordResetCredentialFields(adminPrincipalId);
    const betaManagerSessionToken: string = await createOrganizationMemberSessionFixture({
      db,
      email: 'manager@example.com',
      organizationId: betaOrganization.organization.id,
      principalId: 'prn_beta_manager',
      role: 'admin',
      sessionId: 'ses_beta_manager',
      sessionSecret: defaultApiConfig.sessionSecret,
      sessionToken: 'beta-manager-session-token',
    });

    const inviteResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(betaManagerSessionToken, betaOrganization.organization.slug),
      method: 'POST',
      payload: {
        email: 'admin@example.com',
      },
      url: '/v1/users',
    });
    expect(inviteResponse.statusCode).toBe(200);
    expect(inviteUserResponseSchema.parse(inviteResponse.json()).invitation).toBeNull();
    await assignOrganizationRole(adminPrincipalId, betaOrganization.organization.id, 'admin', 'asg_beta_target_admin');

    const resetIssueResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(betaManagerSessionToken, betaOrganization.organization.slug),
      method: 'POST',
      url: buildUserPasswordResetApiPath('admin@example.com'),
    });
    expect(resetIssueResponse.statusCode).toBe(409);
    expect(errorResponseSchema.parse(resetIssueResponse.json()).error.code).toBe('password_reset_not_available');
    await expect(readPasswordResetCredentialFields(adminPrincipalId)).resolves.toEqual(credentialFieldsBeforeIssue);

    const adminWhoAmIResponse: LightMyRequestResponse = await app.inject({
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
      },
      method: 'GET',
      url: '/v1/whoami',
    });
    expect(adminWhoAmIResponse.statusCode).toBe(200);
  });

  it('does not let a second organization take over a pending invitation token', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const betaOrganization: CreateOrganizationResponse = await createOrganization(
      installPayload.sessionToken,
      'Beta Dev',
      'beta-dev',
    );
    const betaManagerSessionToken: string = await createOrganizationMemberSessionFixture({
      db,
      email: 'manager@example.com',
      organizationId: betaOrganization.organization.id,
      principalId: 'prn_beta_pending_manager',
      role: 'admin',
      sessionId: 'ses_beta_pending_manager',
      sessionSecret: defaultApiConfig.sessionSecret,
      sessionToken: 'beta-pending-manager-session-token',
    });

    const acmeInvitePayload: InviteUserResponse = inviteUserResponseSchema.parse(
      (
        await app.inject({
          headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
          method: 'POST',
          payload: {
            email: 'pending@example.com',
          },
          url: '/v1/users',
        })
      ).json(),
    );
    const acmeActivationToken: string = requireQueryParam(
      new URL(acmeInvitePayload.invitation?.activationUrl ?? ''),
      'token',
    );

    const betaInviteResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(betaManagerSessionToken, betaOrganization.organization.slug),
      method: 'POST',
      payload: {
        email: 'pending@example.com',
      },
      url: '/v1/users',
    });
    expect(betaInviteResponse.statusCode).toBe(200);
    expect(inviteUserResponseSchema.parse(betaInviteResponse.json()).invitation).toBeNull();

    const browserCsrfToken: string = requireSetCookieValue(createBrowserCsrfCookie(), compartmentCsrfCookieName);
    const activationFlowCookie: string = await readActivationFlowCookie(acmeActivationToken, 'pending@example.com');
    const activateResponse: LightMyRequestResponse = await app.inject({
      headers: {
        [compartmentCsrfHeaderName]: browserCsrfToken,
        cookie: `${activationFlowCookie}; ${compartmentCsrfCookieName}=${browserCsrfToken}`,
        host: defaultApiConfig.controlPlaneHost,
        origin: readDefaultBrowserOrigin(),
      },
      method: 'POST',
      payload: {
        email: 'pending@example.com',
        password: 'pendingsecretpassword',
        sessionDelivery: 'cookie',
      },
      url: authApiActivatePathname,
    });
    expect(activateResponse.statusCode).toBe(200);
    const activatePayload: ActivateResponse = activateResponseSchema.parse(activateResponse.json());
    expect(activatePayload.organizations.map((organization: OrganizationSummary): string => organization.slug)).toEqual(
      ['acme-dev'],
    );
    expect(activatePayload.redirectTo).toBe('/orgs/acme-dev/projects');
    const activatedSessionToken: string = requireSetCookieValue(
      activateResponse.headers['set-cookie'],
      compartmentSessionCookieName,
    );
    const betaProjectsResponse: LightMyRequestResponse = await app.inject({
      headers: {
        authorization: `Bearer ${activatedSessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: betaOrganization.organization.slug,
      },
      method: 'GET',
      url: '/v1/projects',
    });
    expect(betaProjectsResponse.statusCode).toBe(404);
    expect(errorResponseSchema.parse(betaProjectsResponse.json()).error.code).toBe('organization_not_found');
  });

  it('does not let another organization turn an SSO-only principal into a local-password account', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const acmeOrganizationId: string = await readOrganizationIdBySlug('acme-dev');
    const betaOrganization: CreateOrganizationResponse = await createOrganization(
      installPayload.sessionToken,
      'Beta Dev',
      'beta-dev',
    );
    const betaManagerSessionToken: string = await createOrganizationMemberSessionFixture({
      db,
      email: 'manager@example.com',
      organizationId: betaOrganization.organization.id,
      principalId: 'prn_beta_sso_manager',
      role: 'admin',
      sessionId: 'ses_beta_sso_manager',
      sessionSecret: defaultApiConfig.sessionSecret,
      sessionToken: 'beta-sso-manager-session-token',
    });
    await createStoredSsoOidcProviderFixture({
      db,
      organizationId: acmeOrganizationId,
      providerId: 'sop_acme',
      variablesMasterKey: defaultApiConfig.variablesMasterKey,
    });
    await db.insert(principals).values({
      email: 'sso-only@example.com',
      id: 'prn_sso_only',
      type: 'user',
    });
    await db.insert(organizationMemberships).values({
      id: 'mem_sso_only_acme',
      organizationId: acmeOrganizationId,
      principalId: 'prn_sso_only',
    });
    await db.insert(ssoOidcIdentities).values({
      id: 'soi_sso_only',
      principalId: 'prn_sso_only',
      providerId: 'sop_acme',
      subject: 'subject_sso_only',
    });

    const betaInviteResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(betaManagerSessionToken, betaOrganization.organization.slug),
      method: 'POST',
      payload: {
        email: 'sso-only@example.com',
      },
      url: '/v1/users',
    });
    expect(betaInviteResponse.statusCode).toBe(200);
    expect(inviteUserResponseSchema.parse(betaInviteResponse.json()).invitation).toBeNull();
    await expect(
      db
        .select({
          bootstrapTokenHash: localCredentials.bootstrapTokenHash,
          passwordHash: localCredentials.passwordHash,
        })
        .from(localCredentials)
        .where(eq(localCredentials.principalId, 'prn_sso_only')),
    ).resolves.toEqual([]);

    const loginResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      payload: {
        email: 'sso-only@example.com',
        organizationSlug: betaOrganization.organization.slug,
        password: 'localpassword',
      },
      url: '/v1/auth/login',
    });
    expect(loginResponse.statusCode).toBe(401);
    expect(errorResponseSchema.parse(loginResponse.json()).error.code).toBe('invalid_credentials');
  });

  it('records organization audit events when the system operator issues a password reset', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const issueResponse: LightMyRequestResponse = await systemApp.inject({
      headers: buildSystemAuthorizationHeaders(),
      method: 'POST',
      payload: {
        email: 'admin@example.com',
      },
      url: '/internal/system/auth/password-reset/issue',
    });
    expect(issueResponse.statusCode).toBe(200);
    issuePasswordResetResponseSchema.parse(issueResponse.json());
    const adminPrincipalId: string = await readPrincipalIdByEmail('admin@example.com');

    const [auditEvent] = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.eventType, 'organization.user.password_reset_issued'),
          eq(auditEvents.targetId, adminPrincipalId),
        ),
      );
    expect(auditEvent).toMatchObject({
      actorType: 'system',
      organizationId: installPayload.organization.id,
      scopeType: 'organization',
      targetDisplayName: 'admin@example.com',
      targetId: adminPrincipalId,
      targetType: 'user',
    });
    expect(JSON.parse(auditEvent!.metadataJson)).toEqual({ email: 'admin@example.com' });
  });

  it('returns not found when the target user is outside the selected organization', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const invitePayload: InviteUserResponse = inviteUserResponseSchema.parse(
      (
        await app.inject({
          headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
          method: 'POST',
          payload: {
            email: 'viewer@example.com',
          },
          url: '/v1/users',
        })
      ).json(),
    );
    const activationToken: string = requireQueryParam(new URL(invitePayload.invitation?.activationUrl ?? ''), 'token');
    const activateResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      payload: {
        bootstrapToken: activationToken,
        email: 'viewer@example.com',
        password: 'viewersecretpassword',
      },
      url: authApiActivatePathname,
    });
    expect(activateResponse.statusCode).toBe(200);

    const createOrganizationResponse: LightMyRequestResponse = await app.inject({
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
      },
      method: 'POST',
      payload: {
        name: 'Beta Dev',
        slug: 'beta-dev',
      },
      url: '/v1/organizations',
    });
    expect(createOrganizationResponse.statusCode).toBe(200);

    const response: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken, 'beta-dev'),
      method: 'POST',
      url: buildUserPasswordResetApiPath('viewer@example.com'),
    });

    expect(response.statusCode).toBe(404);
    expect(errorResponseSchema.parse(response.json()).error.code).toBe('password_reset_user_not_found');
  });

  it('returns conflict for invited users on the admin password reset route', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const inviteResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'POST',
      payload: {
        email: 'viewer@example.com',
      },
      url: '/v1/users',
    });
    expect(inviteResponse.statusCode).toBe(200);

    const response: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'POST',
      url: buildUserPasswordResetApiPath('viewer@example.com'),
    });

    expect(response.statusCode).toBe(409);
    expect(errorResponseSchema.parse(response.json()).error.code).toBe('password_reset_not_available');
  });

  it('manages organization users through invite, list, and remove flows', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const inviteResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      payload: {
        email: 'Viewer@Example.com',
      },
      url: '/v1/users',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(inviteResponse.statusCode).toBe(200);
    const invitePayload: InviteUserResponse = inviteUserResponseSchema.parse(inviteResponse.json());
    expect(invitePayload.user.status).toBe('invited');
    expect(invitePayload.user.roleNames).toEqual([]);
    expect(invitePayload.invitation?.activationUrl).toContain('/activate?');

    const listResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/users',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(listResponse.statusCode).toBe(200);
    const listPayload: UserListResponse = userListResponseSchema.parse(listResponse.json());
    expect(listPayload.users).toHaveLength(2);
    expect(listPayload.users.map((user: OrganizationUserSummary): string => user.email)).toEqual(
      expect.arrayContaining(['Viewer@Example.com', 'admin@example.com']),
    );
    expect(
      listPayload.users.find((user: OrganizationUserSummary): boolean => user.email === 'Viewer@Example.com')
        ?.roleNames,
    ).toEqual([]);

    const filteredListResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/users?search=viewer&orderBy=email&sort=desc&page=1&perPage=1',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(filteredListResponse.statusCode).toBe(200);
    const filteredListPayload: UserListResponse = userListResponseSchema.parse(filteredListResponse.json());
    expect(filteredListPayload.pagination).toEqual({
      page: 1,
      perPage: 1,
      totalItems: 1,
      totalPages: 1,
    });
    expect(filteredListPayload.users.map((user: OrganizationUserSummary): string => user.email)).toEqual([
      'Viewer@Example.com',
    ]);

    const selfRemoveAdminResponse: LightMyRequestResponse = await app.inject({
      method: 'DELETE',
      url: `/v1/users/${encodeURIComponent('admin@example.com')}`,
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(selfRemoveAdminResponse.statusCode).toBe(409);
    expect(errorResponseSchema.parse(selfRemoveAdminResponse.json()).error.code).toBe(
      'self_admin_membership_change_forbidden',
    );

    const removeResponse: LightMyRequestResponse = await app.inject({
      method: 'DELETE',
      url: `/v1/users/${encodeURIComponent('viewer@example.com')}`,
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(removeResponse.statusCode).toBe(200);
    const removePayload: RemoveUserResponse = removeUserResponseSchema.parse(removeResponse.json());
    expect(removePayload.success).toBe(true);
    const [removedUserAuditEvent] = await db
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.eventType, 'organization.user.removed'), eq(auditEvents.targetId, invitePayload.user.id)),
      );
    expect(removedUserAuditEvent).toMatchObject({
      targetDisplayName: 'Viewer@Example.com',
      targetId: invitePayload.user.id,
      targetType: 'user',
    });
    expect(JSON.parse(removedUserAuditEvent!.metadataJson)).toEqual({ email: 'Viewer@Example.com' });

    const usersAfterRemoveResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/users',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(usersAfterRemoveResponse.statusCode).toBe(200);
    const usersAfterRemovePayload: UserListResponse = userListResponseSchema.parse(usersAfterRemoveResponse.json());
    expect(usersAfterRemovePayload.users).toHaveLength(1);
    expect(usersAfterRemovePayload.users[0]?.email).toBe('admin@example.com');
  });

  it('lists page users with batched group counts and aggregated direct plus group role names', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const organizationId: string = (await db.select().from(organizations).where(eq(organizations.slug, 'acme-dev')))[0]!
      .id;
    const viewerInvitePayload: InviteUserResponse = inviteUserResponseSchema.parse(
      (
        await app.inject({
          headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
          method: 'POST',
          payload: {
            email: 'viewer@example.com',
          },
          url: '/v1/users',
        })
      ).json(),
    );
    const viewerRoleId: string = await readOrganizationRoleId(organizationId, 'viewer');
    const deployerRoleId: string = await readOrganizationRoleId(organizationId, 'deployer');

    await db.insert(projects).values({
      id: 'prj_billing',
      name: 'billing',
      organizationId,
    });
    await db.insert(accessAssignments).values({
      id: 'asg_viewer_project_viewer',
      organizationId,
      roleId: viewerRoleId,
      scopeId: 'prj_billing',
      scopeType: 'project',
      subjectId: viewerInvitePayload.user.id,
      subjectType: 'principal',
    });

    const singleInviteListRun: { queryCount: number; result: LightMyRequestResponse } = await capturePoolQueryCount(
      pool,
      async (): Promise<LightMyRequestResponse> => {
        return await app.inject({
          headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
          method: 'GET',
          url: '/v1/users?orderBy=email&sort=asc',
        });
      },
    );
    expect(singleInviteListRun.result.statusCode).toBe(200);
    const operatorInvitePayload: InviteUserResponse = inviteUserResponseSchema.parse(
      (
        await app.inject({
          headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
          method: 'POST',
          payload: {
            email: 'operator@example.com',
          },
          url: '/v1/users',
        })
      ).json(),
    );

    await db.insert(accessGroups).values({
      id: 'grp_ops',
      name: 'Operators',
      organizationId,
    });
    await db.insert(accessGroupMemberships).values({
      groupId: 'grp_ops',
      id: 'gmb_operator',
      principalId: operatorInvitePayload.user.id,
    });
    await db.insert(accessAssignments).values([
      {
        id: 'asg_operator_direct_viewer',
        organizationId,
        roleId: viewerRoleId,
        scopeId: organizationId,
        scopeType: 'organization',
        subjectId: operatorInvitePayload.user.id,
        subjectType: 'principal',
      },
      {
        id: 'asg_operator_group_deployer',
        organizationId,
        roleId: deployerRoleId,
        scopeId: organizationId,
        scopeType: 'organization',
        subjectId: 'grp_ops',
        subjectType: 'group',
      },
    ]);

    const multiInviteListRun: { queryCount: number; result: LightMyRequestResponse } = await capturePoolQueryCount(
      pool,
      async (): Promise<LightMyRequestResponse> => {
        return await app.inject({
          headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
          method: 'GET',
          url: '/v1/users?orderBy=email&sort=asc',
        });
      },
    );
    const listResponse: LightMyRequestResponse = multiInviteListRun.result;

    expect(listResponse.statusCode).toBe(200);
    const listPayload: UserListResponse = userListResponseSchema.parse(listResponse.json());
    expect(
      listPayload.users.find((user: OrganizationUserSummary): boolean => user.email === 'viewer@example.com'),
    ).toMatchObject({
      accessSummary: 'Limited view',
      directAccessScopeLabels: ['billing'],
      groupCount: 0,
      groupNames: [],
      roleNames: ['viewer'],
    });
    expect(
      listPayload.users.find((user: OrganizationUserSummary): boolean => user.email === 'operator@example.com'),
    ).toMatchObject({
      accessSummary: 'Deploy',
      directAccessScopeLabels: [],
      groupCount: 1,
      groupNames: ['Operators'],
      roleNames: ['deployer', 'viewer'],
    });
    expect(viewerInvitePayload.user.id).not.toBe(operatorInvitePayload.user.id);
    expect(multiInviteListRun.queryCount).toBe(singleInviteListRun.queryCount);
  });

  it('lists automation principals explicitly and rejects direct admin user-management actions', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const organizationId: string = (await db.select().from(organizations).where(eq(organizations.slug, 'acme-dev')))[0]!
      .id;

    await db.insert(principals).values({
      email: 'git-source+src_123@compartment.internal',
      id: 'prn_git_source',
      type: 'automation',
    });
    await seedOrganizationSystemRole('prn_git_source', organizationId, 'deployer');

    const listResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'GET',
      url: '/v1/users?search=system',
    });
    const humanListResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'GET',
      url: '/v1/users?type=user',
    });
    const automationListResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'GET',
      url: '/v1/users?type=automation',
    });

    expect(listResponse.statusCode).toBe(200);
    const listPayload: UserListResponse = userListResponseSchema.parse(listResponse.json());
    expect(humanListResponse.statusCode).toBe(200);
    const humanListPayload: UserListResponse = userListResponseSchema.parse(humanListResponse.json());
    expect(automationListResponse.statusCode).toBe(200);
    const automationListPayload: UserListResponse = userListResponseSchema.parse(automationListResponse.json());
    expect(listPayload.users).toEqual([
      expect.objectContaining({
        access: 'allowed',
        email: 'git-source+src_123@compartment.internal',
        roleNames: ['deployer'],
        status: 'active',
        type: 'automation',
      }),
    ]);
    expect(humanListPayload.users.map((user: OrganizationUserSummary): string => user.email)).not.toContain(
      'git-source+src_123@compartment.internal',
    );
    expect(automationListPayload.users).toEqual([
      expect.objectContaining({
        email: 'git-source+src_123@compartment.internal',
        type: 'automation',
      }),
    ]);

    const blockResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'POST',
      url: `/v1/users/${encodeURIComponent('git-source+src_123@compartment.internal')}/block`,
    });
    expect(blockResponse.statusCode).toBe(409);
    expect(errorResponseSchema.parse(blockResponse.json()).error.code).toBe('user_not_manageable');

    const removeResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'DELETE',
      url: `/v1/users/${encodeURIComponent('git-source+src_123@compartment.internal')}`,
    });
    expect(removeResponse.statusCode).toBe(409);
    expect(errorResponseSchema.parse(removeResponse.json()).error.code).toBe('user_not_manageable');

    const passwordResetResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'POST',
      url: buildUserPasswordResetApiPath('git-source+src_123@compartment.internal'),
    });
    expect(passwordResetResponse.statusCode).toBe(409);
    expect(errorResponseSchema.parse(passwordResetResponse.json()).error.code).toBe('user_not_manageable');

    const inviteResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'POST',
      payload: {
        email: 'git-source+src_123@compartment.internal',
      },
      url: '/v1/users',
    });
    expect(inviteResponse.statusCode).toBe(409);
    expect(errorResponseSchema.parse(inviteResponse.json()).error.code).toBe('user_not_manageable');
  });

  it('blocks and unblocks organization user password authentication without removing the membership', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const invitePayload: InviteUserResponse = inviteUserResponseSchema.parse(
      (
        await app.inject({
          headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
          method: 'POST',
          payload: {
            email: 'viewer@example.com',
          },
          url: '/v1/users',
        })
      ).json(),
    );
    const activationToken: string = requireQueryParam(new URL(invitePayload.invitation?.activationUrl ?? ''), 'token');

    const activateResponse: LightMyRequestResponse = await app.inject({
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
      payload: {
        bootstrapToken: activationToken,
        email: 'viewer@example.com',
        password: 'viewersecretpassword',
      },
      url: authApiActivatePathname,
    });
    expect(activateResponse.statusCode).toBe(200);
    const activatePayload: ActivateResponse = activateResponseSchema.parse(activateResponse.json());
    const activatedSessionToken: string = requireTokenResponseSessionToken(activatePayload);
    const activatedSessionId: string = await readStoredAuthSessionIdByToken(activatedSessionToken);
    await createStoredAppAccessSessionFixture(
      db,
      defaultApiConfig.sessionSecret,
      'aps_viewer_blocked',
      activatedSessionId,
    );

    const blockResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'POST',
      url: `/v1/users/${encodeURIComponent('viewer@example.com')}/block`,
    });
    expect(blockResponse.statusCode).toBe(200);
    expect(organizationUserResponseSchema.parse(blockResponse.json()).user.access).toBe('blocked');
    expect((await readStoredAuthSession(activatedSessionId)).revokedAt).not.toBeNull();
    expect((await readStoredAppAccessSession('aps_viewer_blocked')).revokedAt).not.toBeNull();
    expect(appAccessEdgeServiceMocks.invalidateEdgeAppAccessSessions).toHaveBeenCalledWith(activatedSessionId);

    const blockedProjectsResponse: LightMyRequestResponse = await app.inject({
      headers: {
        authorization: `Bearer ${activatedSessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
      method: 'GET',
      url: '/v1/projects',
    });
    expect(blockedProjectsResponse.statusCode).toBe(401);

    const blockedLoginResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      payload: {
        email: 'viewer@example.com',
        organizationSlug: 'acme-dev',
        password: 'viewersecretpassword',
      },
      url: '/v1/auth/login',
    });
    expect(blockedLoginResponse.statusCode).toBe(401);
    expect(errorResponseSchema.parse(blockedLoginResponse.json()).error.code).toBe('invalid_credentials');

    const blockedListResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'GET',
      url: '/v1/users?search=blocked',
    });
    const blockedListPayload: UserListResponse = userListResponseSchema.parse(blockedListResponse.json());
    expect(blockedListPayload.users.map((user: OrganizationUserSummary): string => user.email)).toEqual([
      'viewer@example.com',
    ]);
    expect(blockedListPayload.users[0]?.access).toBe('blocked');

    const unblockResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'POST',
      url: `/v1/users/${encodeURIComponent('viewer@example.com')}/unblock`,
    });
    expect(unblockResponse.statusCode).toBe(200);
    expect(organizationUserResponseSchema.parse(unblockResponse.json()).user.access).toBe('allowed');

    const unblockedLoginResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      payload: {
        email: 'viewer@example.com',
        organizationSlug: 'acme-dev',
        password: 'viewersecretpassword',
      },
      url: '/v1/auth/login',
    });
    expect(unblockedLoginResponse.statusCode).toBe(200);
  });

  it('rejects local activation while the invitation membership is blocked', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const invitePayload: InviteUserResponse = inviteUserResponseSchema.parse(
      (
        await app.inject({
          headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
          method: 'POST',
          payload: {
            email: 'viewer@example.com',
          },
          url: '/v1/users',
        })
      ).json(),
    );
    const activationToken: string = requireQueryParam(new URL(invitePayload.invitation?.activationUrl ?? ''), 'token');
    const blockResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'POST',
      url: `/v1/users/${encodeURIComponent('viewer@example.com')}/block`,
    });
    expect(blockResponse.statusCode).toBe(200);

    const activationResponse: LightMyRequestResponse = await app.inject({
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
      payload: {
        bootstrapToken: activationToken,
        email: 'viewer@example.com',
        password: 'viewersecretpassword',
      },
      url: authApiActivatePathname,
    });

    expect(activationResponse.statusCode).toBe(401);
    expect(errorResponseSchema.parse(activationResponse.json()).error.code).toBe('invalid_bootstrap_token');
  });

  it('returns edge sync failures after invite while keeping the committed membership', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState.mockRejectedValueOnce(createEdgeStateUpdateFailedError());

    const inviteResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      payload: {
        email: 'viewer@example.com',
      },
      url: '/v1/users',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(inviteResponse.statusCode).toBe(502);
    expect(errorResponseSchema.parse(inviteResponse.json()).error.code).toBe('edge_state_update_failed');

    const listResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/users',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(listResponse.statusCode).toBe(200);
    const listPayload: UserListResponse = userListResponseSchema.parse(listResponse.json());
    const invitedUser: OrganizationUserSummary | undefined = listPayload.users.find(
      (user: OrganizationUserSummary): boolean => user.email === 'viewer@example.com',
    );
    expect(invitedUser?.roleNames).toEqual([]);
    expect(invitedUser?.status).toBe('invited');
  });
  it('returns edge sync failures after removals while keeping the membership deletion committed', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    await app.inject({
      method: 'POST',
      payload: {
        email: 'viewer@example.com',
      },
      url: '/v1/users',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState.mockRejectedValueOnce(createEdgeStateUpdateFailedError());

    const removeResponse: LightMyRequestResponse = await app.inject({
      method: 'DELETE',
      url: `/v1/users/${encodeURIComponent('viewer@example.com')}`,
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(removeResponse.statusCode).toBe(502);
    expect(errorResponseSchema.parse(removeResponse.json()).error.code).toBe('edge_state_update_failed');

    const listResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/users',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(listResponse.statusCode).toBe(200);
    const listPayload: UserListResponse = userListResponseSchema.parse(listResponse.json());
    expect(
      listPayload.users.find((user: OrganizationUserSummary): boolean => user.email === 'viewer@example.com'),
    ).toBe(undefined);
  });
  it('maps invite races to organization user conflicts instead of server errors', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const principalInsertClient: PoolClient = await pool.connect();

    try {
      await principalInsertClient.query('BEGIN');
      await principalInsertClient.query('insert into principals (id, type, email) values ($1, $2, $3)', [
        'prn_race_invite',
        'user',
        'Viewer@Example.com',
      ]);

      const inviteResponsePromise: Promise<LightMyRequestResponse> = app.inject({
        method: 'POST',
        payload: {
          email: 'viewer@example.com',
        },
        url: '/v1/users',
        headers: {
          authorization: `Bearer ${installPayload.sessionToken}`,
          [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
        },
      });

      await waitForConcurrentDatabaseWork();
      await principalInsertClient.query('COMMIT');

      const inviteResponse: LightMyRequestResponse = await inviteResponsePromise;

      expect(inviteResponse.statusCode).toBe(409);
      expect(errorResponseSchema.parse(inviteResponse.json()).error.code).toBe('organization_user_exists');
    } finally {
      await rollbackOpenTransaction(principalInsertClient);
      principalInsertClient.release();
    }
  });
  it('consumes each invitation token at most once under concurrent activation', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const invitePayload: InviteUserResponse = inviteUserResponseSchema.parse(
      (
        await app.inject({
          method: 'POST',
          payload: {
            email: 'viewer@example.com',
          },
          url: '/v1/users',
          headers: {
            authorization: `Bearer ${installPayload.sessionToken}`,
            [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
          },
        })
      ).json(),
    );
    const activationUrl: URL = new URL(invitePayload.invitation?.activationUrl ?? '');
    const activationToken: string = requireQueryParam(activationUrl, 'token');
    const credentialsLockClient: PoolClient = await pool.connect();

    try {
      await credentialsLockClient.query('BEGIN');
      await credentialsLockClient.query(
        'select principal_id from local_credentials where principal_id = $1 for update',
        [invitePayload.user.id],
      );

      const activationPayload: {
        bootstrapToken: string;
        email: string;
        password: string;
      } = {
        bootstrapToken: activationToken,
        email: 'viewer@example.com',
        password: 'viewersecretpassword',
      };
      const firstActivationPromise: Promise<LightMyRequestResponse> = app.inject({
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
        payload: activationPayload,
        url: authApiActivatePathname,
      });
      const secondActivationPromise: Promise<LightMyRequestResponse> = app.inject({
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
        payload: activationPayload,
        url: authApiActivatePathname,
      });

      await waitForConcurrentDatabaseWork();
      await credentialsLockClient.query('COMMIT');

      const activationResponses: [LightMyRequestResponse, LightMyRequestResponse] = await Promise.all([
        firstActivationPromise,
        secondActivationPromise,
      ]);
      const statusCodes: number[] = activationResponses
        .map((response: LightMyRequestResponse): number => response.statusCode)
        .sort((left: number, right: number): number => left - right);
      const failedActivation: LightMyRequestResponse | undefined = activationResponses.find(
        (response: LightMyRequestResponse): boolean => response.statusCode === 401,
      );
      const storedViewerSessions: { value: number }[] = await db
        .select({ value: count() })
        .from(authSessions)
        .where(eq(authSessions.principalId, invitePayload.user.id));

      expect(statusCodes).toEqual([200, 401]);
      expect(failedActivation).toBeDefined();
      expect(errorResponseSchema.parse(failedActivation?.json()).error.code).toBe('invalid_bootstrap_token');
      expect(storedViewerSessions[0]?.value).toBe(1);
    } finally {
      await rollbackOpenTransaction(credentialsLockClient);
      credentialsLockClient.release();
    }
  });
});

async function createOrganization(
  sessionToken: string,
  name: string,
  slug: string,
): Promise<CreateOrganizationResponse> {
  const response: LightMyRequestResponse = await app.inject({
    headers: {
      authorization: `Bearer ${sessionToken}`,
    },
    method: 'POST',
    payload: {
      name,
      slug,
    },
    url: '/v1/organizations',
  });
  expect(response.statusCode).toBe(200);

  return createOrganizationResponseSchema.parse(response.json());
}

async function readOrganizationIdBySlug(slug: string): Promise<string> {
  const rows: { id: string }[] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);
  const organizationId: string | undefined = rows[0]?.id;
  if (organizationId === undefined) {
    throw new Error(`Expected organization ${slug}.`);
  }

  return organizationId;
}

async function readPrincipalIdByEmail(email: string): Promise<string> {
  const rows: { id: string }[] = await db
    .select({ id: principals.id })
    .from(principals)
    .where(eq(principals.email, email))
    .limit(1);
  const principalId: string | undefined = rows[0]?.id;
  if (principalId === undefined) {
    throw new Error(`Expected principal ${email}.`);
  }

  return principalId;
}

async function removePrincipalFromOrganization(principalId: string, organizationId: string): Promise<void> {
  await db
    .delete(accessAssignments)
    .where(
      and(
        eq(accessAssignments.organizationId, organizationId),
        eq(accessAssignments.subjectType, 'principal'),
        eq(accessAssignments.subjectId, principalId),
      ),
    );
  await db
    .delete(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.principalId, principalId),
      ),
    );
}

async function seedOrganizationSystemRole(
  principalId: string,
  organizationId: string,
  roleName: 'admin' | 'deployer' | 'readonly' | 'viewer',
): Promise<void> {
  const roleId: string = await readOrganizationRoleId(organizationId, roleName);

  await db.insert(organizationMemberships).values({
    id: `mem_${principalId}`,
    organizationId,
    principalId,
  });
  await db.insert(accessAssignments).values({
    id: `asg_${principalId}`,
    organizationId,
    roleId,
    scopeId: organizationId,
    scopeType: 'organization',
    subjectId: principalId,
    subjectType: 'principal',
  });
}

async function assignOrganizationRole(
  principalId: string,
  organizationId: string,
  roleName: 'admin' | 'deployer' | 'readonly' | 'viewer',
  assignmentId: string,
): Promise<void> {
  const roleId: string = await readOrganizationRoleId(organizationId, roleName);

  await db.insert(accessAssignments).values({
    id: assignmentId,
    organizationId,
    roleId,
    scopeId: organizationId,
    scopeType: 'organization',
    subjectId: principalId,
    subjectType: 'principal',
  });
}

async function readOrganizationRoleId(
  organizationId: string,
  roleName: 'admin' | 'deployer' | 'readonly' | 'viewer',
): Promise<string> {
  const rows: { id: string }[] = await db
    .select({ id: accessRoles.id })
    .from(accessRoles)
    .where(and(eq(accessRoles.organizationId, organizationId), eq(accessRoles.name, roleName)))
    .limit(1);
  const roleId: string | undefined = rows[0]?.id;
  if (roleId === undefined) {
    throw new Error(`Expected role ${roleName}.`);
  }

  return roleId;
}

function readDefaultBrowserOrigin(): string {
  return new URL(buildRuntimePublicSettings(defaultApiConfig).compartmentUrl).origin;
}

async function readActivationFlowCookie(activationToken: string, email: string): Promise<string> {
  const landingResponse: LightMyRequestResponse = await app.inject({
    method: 'GET',
    query: {
      email,
      token: activationToken,
    },
    url: '/activate',
  });
  expect(landingResponse.statusCode).toBe(302);

  return `__Host-compartment_activate_flow=${requireSetCookieValue(
    landingResponse.headers['set-cookie'],
    '__Host-compartment_activate_flow',
  )}`;
}

function buildUserPasswordResetApiPath(email: string): string {
  return `/v1/users/${encodeURIComponent(email)}/password-reset`;
}

function requireTokenResponseSessionToken(response: ActivateResponse): string {
  if (response.sessionToken === undefined) {
    throw new Error('Expected token activation response.');
  }

  return response.sessionToken;
}

async function readStoredAuthSessionIdByToken(sessionToken: string): Promise<string> {
  return await readStoredAuthSessionIdByTokenFixture(db, sessionToken, defaultApiConfig.sessionSecret);
}

async function readStoredAuthSession(sessionId: string): Promise<{ revokedAt: Date | null }> {
  return await readStoredAuthSessionFixture(db, sessionId);
}

async function readPasswordResetCredentialFields(principalId: string): Promise<PasswordResetCredentialFields> {
  const rows: PasswordResetCredentialFields[] = await db
    .select({
      passwordResetOrganizationId: localCredentials.passwordResetOrganizationId,
      passwordResetTokenExpiresAt: localCredentials.passwordResetTokenExpiresAt,
      passwordResetTokenHash: localCredentials.passwordResetTokenHash,
    })
    .from(localCredentials)
    .where(eq(localCredentials.principalId, principalId));
  const row: PasswordResetCredentialFields | undefined = rows[0];
  if (row === undefined) {
    throw new Error(`Expected local credentials for ${principalId}.`);
  }

  return row;
}

async function readStoredAppAccessSession(appSessionId: string): Promise<{ revokedAt: Date | null }> {
  return await readStoredAppAccessSessionFixture(db, appSessionId);
}

async function capturePoolQueryCount<T>(
  dbPool: Pool,
  action: () => Promise<T>,
): Promise<{ queryCount: number; result: T }> {
  const querySpy: MockInstance = vi.spyOn(dbPool, 'query');
  try {
    const result: T = await action();
    return {
      queryCount: querySpy.mock.calls.length,
      result,
    };
  } finally {
    querySpy.mockRestore();
  }
}
