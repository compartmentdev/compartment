import {
  issuePasswordResetResponseSchema,
  deploymentInspectResponseSchema,
  appAccessExchangeResponseSchema,
  compartmentAppCallbackPathname,
  compartmentSessionCookieName,
  deploymentLogsResponseSchema,
  deploymentStatusResponseSchema,
  deployResponseSchema,
  errorResponseSchema,
  loginResponseSchema,
  resetPasswordResponseSchema,
  type AppAccessExchangeResponse,
  type DeploymentLogsResponse,
  type DeploymentInspectResponse,
  type DeploymentStatusResponse,
  type DeploymentSummary,
  type DeployResponse,
  type IssuePasswordResetResponse,
  type InstallResponse,
  type LoginResponse,
  type ResetPasswordResponse,
  type WorkerClaimDeploymentResponse,
  type WorkerClaimedDeployment,
  compartmentCsrfCookieName,
  compartmentCsrfHeaderName,
  compartmentCurrentOrganizationHeaderName,
} from '@compartment/contracts';
import type { LightMyRequestResponse } from 'fastify';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { eq } from 'drizzle-orm';
import type { ApiApp } from '../src/app.types';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';

import {
  appAccessSessions,
  authSessions,
  buildArtifacts,
  deployments,
  localCredentials,
  operations,
  principals,
  projectServices,
  projects,
} from '../src/db/schema';
import { hashToken } from '../src/lib/tokens';
import { authApiLoginPathname } from '../src/routes/auth/auth-api-paths';

import { createBrowserCsrfCookie } from '../src/services/browser-csrf-cookie.service';
import { buildRuntimePublicSettings } from '../src/services/public-hosts.service';
import {
  allLogLinesMatchService,
  claimNextQueuedDeployment,
  completeQueuedDeployment,
  createMultiServiceDescriptor,
  createMultiServiceRoutes,
  createUnsupportedKindDescriptor,
  hasLogLineForService,
  injectDeployRequest,
  installCompartment,
  readStoredRoutesByService,
  requireClaimedDeployment,
  requireClaimedDeploymentByServiceName,
  requireDeploymentByServiceName,
  requireDeployResponseDeployment,
  requireQueryParam,
  requireServiceId,
  requireSetCookieValue,
  requireSingleDeployment,
} from './api-integration.harness';
import type { StoredDeploymentRow, StoredOperationRow } from './api.integration.types';
import {
  createApiIntegrationApps,
  createApiIntegrationTestContext,
  cleanupApiIntegrationRuntime,
  cleanupApiIntegrationTlsDirectory,
  configureApiRuntimeWithPublicIngress,
  resetApiIntegrationTlsDirectory,
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

function buildSystemAuthorizationHeaders(token: string = 'test-system-token'): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
  };
}

const {
  apiConfig: defaultApiConfig,
  databaseUrl: apiIntegrationDatabaseUrl,
  testCustomTlsDirectory,
} = createApiIntegrationTestContext('api_integration_browser_reset', 'api-integration-browser-reset');
let pool!: Pool;
let db!: Database;
let app!: ApiApp;
let systemApp!: ApiApp;
let hasInitializedApiIntegrationRuntime: boolean = false;

describe('Phase 0 API integration browser reset', (): void => {
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
    await resetApiIntegrationTlsDirectory(testCustomTlsDirectory);
    pool = createDatabasePool(apiIntegrationDatabaseUrl);
    db = createDatabase(pool);
    ({ app, systemApp } = await createApiIntegrationApps(defaultApiConfig, db, pool));
    configureApiRuntimeWithPublicIngress(defaultApiConfig, db);
    hasInitializedApiIntegrationRuntime = true;
  });
  afterAll(async (): Promise<void> => {
    await cleanupApiIntegrationTlsDirectory(testCustomTlsDirectory);
  });
  afterEach(async (): Promise<void> => {
    vi.unstubAllGlobals();
    if (!hasInitializedApiIntegrationRuntime) {
      return;
    }

    hasInitializedApiIntegrationRuntime = false;
    await cleanupApiIntegrationRuntime(app, systemApp, pool);
  });
  it('queues one deployment per service and supports aggregate and service-scoped status, inspect, and logs', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const deployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      {
        descriptor: createMultiServiceDescriptor(),
        routes: createMultiServiceRoutes(),
      },
    );
    expect(deployResponse.statusCode).toBe(200);
    const deployPayload: DeployResponse = deployResponseSchema.parse(deployResponse.json());
    expect(
      deployPayload.deployments
        .map((deployment: DeploymentSummary): string => deployment.serviceName)
        .sort((left: string, right: string): number => left.localeCompare(right)),
    ).toEqual(['backoffice', 'web']);
    const storedServices: { id: string; name: string }[] = await db
      .select({
        id: projectServices.id,
        name: projectServices.name,
      })
      .from(projectServices);
    const storedDeployments: StoredDeploymentRow[] = await db.select().from(deployments);
    expect(readStoredRoutesByService(storedDeployments, requireServiceId(storedServices, 'web'))).toEqual(
      createMultiServiceRoutes().routes,
    );
    expect(readStoredRoutesByService(storedDeployments, requireServiceId(storedServices, 'backoffice'))).toEqual([]);

    const claimedDeployments: WorkerClaimedDeployment[] = [
      requireClaimedDeployment(await claimNextQueuedDeployment(app)),
      requireClaimedDeployment(await claimNextQueuedDeployment(app)),
    ];
    const claimedWebDeployment: WorkerClaimedDeployment = requireClaimedDeploymentByServiceName(
      claimedDeployments,
      'web',
    );
    const claimedBackofficeDeployment: WorkerClaimedDeployment = requireClaimedDeploymentByServiceName(
      claimedDeployments,
      'backoffice',
    );
    expect(claimedWebDeployment.routeHost).toBe('smoke-multi-service.localhost');
    expect(claimedBackofficeDeployment.routeHost).toBe('backoffice-smoke-multi-service.localhost');

    await completeQueuedDeployment(app, claimedWebDeployment.deploymentId, claimedWebDeployment.routeHost);
    await completeQueuedDeployment(
      app,
      claimedBackofficeDeployment.deploymentId,
      claimedBackofficeDeployment.routeHost,
    );

    const statusResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/deployments/status?projectName=smoke-multi-service',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(statusResponse.statusCode).toBe(200);
    const statusPayload: DeploymentStatusResponse = deploymentStatusResponseSchema.parse(statusResponse.json());
    expect(statusPayload.deployments).toHaveLength(2);
    expect(requireDeploymentByServiceName(statusPayload.deployments, 'web').routeUrl).toBe(
      'http://smoke-multi-service.localhost',
    );
    expect(requireDeploymentByServiceName(statusPayload.deployments, 'backoffice').routeUrl).toBe(
      'http://backoffice-smoke-multi-service.localhost',
    );

    const scopedStatusResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/deployments/status?projectName=smoke-multi-service&serviceName=backoffice',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(scopedStatusResponse.statusCode).toBe(200);
    const scopedStatusPayload: DeploymentStatusResponse = deploymentStatusResponseSchema.parse(
      scopedStatusResponse.json(),
    );
    expect(requireSingleDeployment(scopedStatusPayload.deployments).serviceName).toBe('backoffice');

    const inspectResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/deployments/inspect?projectName=smoke-multi-service',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(inspectResponse.statusCode).toBe(200);
    const inspectPayload: DeploymentInspectResponse = deploymentInspectResponseSchema.parse(inspectResponse.json());
    expect(inspectPayload.deployments).toHaveLength(2);
    expect(requireDeploymentByServiceName(inspectPayload.deployments, 'web').routes).toEqual(
      createMultiServiceRoutes().routes,
    );
    expect(requireDeploymentByServiceName(inspectPayload.deployments, 'backoffice').routes).toEqual([]);
    expect(requireDeploymentByServiceName(inspectPayload.deployments, 'backoffice').routeHost).toBe(
      'backoffice-smoke-multi-service.localhost',
    );

    const scopedInspectResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/deployments/inspect?projectName=smoke-multi-service&serviceName=backoffice',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(scopedInspectResponse.statusCode).toBe(200);
    const scopedInspectPayload: DeploymentInspectResponse = deploymentInspectResponseSchema.parse(
      scopedInspectResponse.json(),
    );
    expect(requireSingleDeployment(scopedInspectPayload.deployments).serviceName).toBe('backoffice');

    const logsResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/deployments/logs?projectName=smoke-multi-service',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(logsResponse.statusCode).toBe(200);
    const logsPayload: DeploymentLogsResponse = deploymentLogsResponseSchema.parse(logsResponse.json());
    expect(logsPayload.deployments).toHaveLength(2);
    expect(hasLogLineForService(logsPayload.lines, 'web')).toBe(true);
    expect(hasLogLineForService(logsPayload.lines, 'backoffice')).toBe(true);

    const scopedLogsResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/deployments/logs?projectName=smoke-multi-service&serviceName=backoffice',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(scopedLogsResponse.statusCode).toBe(200);
    const scopedLogsPayload: DeploymentLogsResponse = deploymentLogsResponseSchema.parse(scopedLogsResponse.json());
    expect(requireSingleDeployment(scopedLogsPayload.deployments).serviceName).toBe('backoffice');
    expect(allLogLinesMatchService(scopedLogsPayload.lines, 'backoffice')).toBe(true);
  });
  it('queues only the requested descriptor service when serviceName is provided', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const deployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      {
        descriptor: createMultiServiceDescriptor(),
        serviceName: 'backoffice',
      },
    );
    expect(deployResponse.statusCode).toBe(200);
    const deployPayload: DeployResponse = deployResponseSchema.parse(deployResponse.json());
    expect(requireSingleDeployment(deployPayload.deployments).serviceName).toBe('backoffice');
    expect(deployPayload.deployments).toHaveLength(1);

    const claimedDeployment: WorkerClaimedDeployment = requireClaimedDeployment(await claimNextQueuedDeployment(app));
    expect(claimedDeployment.service.name).toBe('backoffice');
    expect(claimedDeployment.routeHost).toBe('backoffice-smoke-multi-service.localhost');

    const nextClaimedPayload: WorkerClaimDeploymentResponse = await claimNextQueuedDeployment(app);
    expect(nextClaimedPayload.deployment).toBeNull();
  });
  it('rejects descriptor services whose kinds are not supported by the current deploy runtime', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const deployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      {
        descriptor: createUnsupportedKindDescriptor(),
      },
    );

    expect(deployResponse.statusCode).toBe(400);
    expect(errorResponseSchema.parse(deployResponse.json()).error.code).toBe('unsupported_service_kind');
    expect(await db.select().from(projects)).toHaveLength(1);
    expect(await db.select().from(projectServices)).toHaveLength(0);
    expect(await db.select().from(buildArtifacts)).toHaveLength(0);
    expect(await db.select().from(deployments)).toHaveLength(0);
  });
  it('completes the browser login flow for a protected app host', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const deployPayload: DeployResponse = deployResponseSchema.parse(
      (await injectDeployRequest(app, installPayload.sessionToken, 'acme-dev')).json(),
    );
    const deployment: DeploymentSummary = requireDeployResponseDeployment(deployPayload);
    const claimedDeployment: WorkerClaimedDeployment = requireClaimedDeployment(await claimNextQueuedDeployment(app));
    await completeQueuedDeployment(app, deployment.id, claimedDeployment.routeHost);

    const loginResponse: LightMyRequestResponse = await app.inject({
      headers: buildBrowserCsrfHeaders(requireSetCookieValue(createBrowserCsrfCookie(), compartmentCsrfCookieName)),
      method: 'POST',
      payload: {
        email: 'Admin@Example.com',
        host: claimedDeployment.routeHost,
        password: 'supersecretpassword',
        path: '/dashboard',
        sessionDelivery: 'cookie',
        state: 'flow',
      },
      url: authApiLoginPathname,
    });

    expect(loginResponse.statusCode).toBe(200);
    expect(loginResponse.headers['set-cookie']).toContain(`${compartmentSessionCookieName}=`);

    const loginPayload: LoginResponse = loginResponseSchema.parse(loginResponse.json());
    const callbackUrl: URL = new URL(requireRedirectTo(loginPayload.redirectTo));
    const code: string = requireQueryParam(callbackUrl, 'code');

    expect(callbackUrl.hostname).toBe(claimedDeployment.routeHost);
    expect(callbackUrl.pathname).toBe(compartmentAppCallbackPathname);
    expect(callbackUrl.searchParams.get('state')).toBe('flow');

    const exchangeResponse: LightMyRequestResponse = await app.inject({
      headers: {
        authorization: 'Bearer test-edge-token',
      },
      method: 'POST',
      payload: {
        code,
        host: claimedDeployment.routeHost,
        state: 'flow',
      },
      url: '/internal/app-access/exchange',
    });

    expect(exchangeResponse.statusCode).toBe(200);
    const exchangePayload: AppAccessExchangeResponse = appAccessExchangeResponseSchema.parse(exchangeResponse.json());
    expect(exchangePayload.redirectPath).toBe('/dashboard');
    expect(exchangePayload.session.host).toBe(claimedDeployment.routeHost);
    expect(exchangePayload.appSessionToken).toBeTruthy();
    expect(exchangePayload.session.principalEmail).toBe('admin@example.com');
  });

  it('issues operator password reset links, replaces prior tokens, and completes browser reset with session revocation', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const adminPrincipalRow: { id: string }[] = await db
      .select({ id: principals.id })
      .from(principals)
      .where(eq(principals.email, 'admin@example.com'))
      .limit(1);
    const adminPrincipalId: string = adminPrincipalRow[0]?.id ?? '';
    expect(adminPrincipalId).toBeTruthy();

    await db.insert(authSessions).values({
      authMethodKind: 'password',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      id: 'ses_old_reset',
      oidcProviderId: null,
      organizationId: null,
      principalId: adminPrincipalId,
      tokenHash: hashToken('old-reset-session', defaultApiConfig.sessionSecret),
    });
    await db.insert(appAccessSessions).values({
      authSessionId: 'ses_old_reset',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      host: 'billing.localhost',
      id: 'aps_old_reset',
      tokenHash: hashToken('old-app-session', defaultApiConfig.sessionSecret),
    });
    const preResetSessionIds: string[] = (
      await db.select({ id: authSessions.id }).from(authSessions).where(eq(authSessions.principalId, adminPrincipalId))
    ).map((row: { id: string }): string => row.id);

    const firstIssueResponse: LightMyRequestResponse = await systemApp.inject({
      headers: buildSystemAuthorizationHeaders(),
      method: 'POST',
      payload: {
        email: 'admin@example.com',
      },
      url: '/internal/system/auth/password-reset/issue',
    });
    expect(firstIssueResponse.statusCode).toBe(200);
    const firstIssuePayload: IssuePasswordResetResponse = issuePasswordResetResponseSchema.parse(
      firstIssueResponse.json(),
    );

    const secondIssueStartedAt: number = Date.now();
    const secondIssueResponse: LightMyRequestResponse = await systemApp.inject({
      headers: buildSystemAuthorizationHeaders(),
      method: 'POST',
      payload: {
        email: 'admin@example.com',
      },
      url: '/internal/system/auth/password-reset/issue',
    });
    const secondIssueCompletedAt: number = Date.now();
    expect(secondIssueResponse.statusCode).toBe(200);
    const secondIssuePayload: IssuePasswordResetResponse = issuePasswordResetResponseSchema.parse(
      secondIssueResponse.json(),
    );
    expect(secondIssuePayload.resetToken).not.toBe(firstIssuePayload.resetToken);
    const secondResetUrl: URL = new URL(secondIssuePayload.resetUrl);
    expect(secondResetUrl.pathname).toBe('/reset-password');
    expect(secondResetUrl.searchParams.get('email')).toBe('admin@example.com');
    expect(secondResetUrl.searchParams.get('token')).toBe(secondIssuePayload.resetToken);
    const secondIssueExpiresAtMs: number = new Date(secondIssuePayload.expiresAt).getTime();
    expect(secondIssueExpiresAtMs - secondIssueStartedAt).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 10_000);
    expect(secondIssueExpiresAtMs - secondIssueCompletedAt).toBeLessThanOrEqual(24 * 60 * 60 * 1000);

    const replacedTokenResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      payload: {
        email: 'admin@example.com',
        password: 'newsupersecretpassword',
        resetToken: firstIssuePayload.resetToken,
      },
      url: '/v1/auth/reset-password',
    });
    expect(replacedTokenResponse.statusCode).toBe(401);
    expect(errorResponseSchema.parse(replacedTokenResponse.json()).error.code).toBe('invalid_password_reset_token');

    const browserCsrfToken: string = requireSetCookieValue(createBrowserCsrfCookie(), compartmentCsrfCookieName);
    const resetFlowCookie: string = await readResetPasswordFlowCookie(secondIssuePayload.resetUrl);
    const resetResponse: LightMyRequestResponse = await app.inject({
      headers: {
        [compartmentCsrfHeaderName]: browserCsrfToken,
        cookie: `${resetFlowCookie}; ${compartmentCsrfCookieName}=${browserCsrfToken}`,
        host: defaultApiConfig.controlPlaneHost,
        origin: readDefaultBrowserOrigin(),
      },
      method: 'POST',
      payload: {
        email: 'admin@example.com',
        password: 'newsupersecretpassword',
        sessionDelivery: 'cookie',
      },
      url: '/v1/auth/reset-password',
    });
    expect(resetResponse.statusCode).toBe(200);
    const resetSessionToken: string = requireSetCookieValue(
      resetResponse.headers['set-cookie'],
      compartmentSessionCookieName,
    );
    expect(String(resetResponse.headers['set-cookie'])).toContain(`${compartmentSessionCookieName}=`);
    expect(String(resetResponse.headers['set-cookie'])).toContain('__Host-compartment_credential_reset_flow=;');
    expect(String(resetResponse.headers['set-cookie'])).toContain('__Host-compartment_pwd_reset_token=;');
    expect(String(resetResponse.headers['set-cookie'])).toContain('Path=/');
    const resetPayload: ResetPasswordResponse = resetPasswordResponseSchema.parse(resetResponse.json());
    expect(resetPayload.redirectTo).toBe('/orgs/acme-dev/projects');
    const resetSessionRows: { authMethodKind: string; organizationId: string | null }[] = await db
      .select({
        authMethodKind: authSessions.authMethodKind,
        organizationId: authSessions.organizationId,
      })
      .from(authSessions)
      .where(eq(authSessions.tokenHash, hashToken(resetSessionToken, defaultApiConfig.sessionSecret)));
    expect(resetSessionRows[0]).toEqual({
      authMethodKind: 'password_scoped',
      organizationId: installPayload.organization.id,
    });

    const reusedTokenResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      payload: {
        email: 'admin@example.com',
        password: 'anotherpassword',
        resetToken: secondIssuePayload.resetToken,
      },
      url: '/v1/auth/reset-password',
    });
    expect(reusedTokenResponse.statusCode).toBe(401);
    expect(errorResponseSchema.parse(reusedTokenResponse.json()).error.code).toBe('invalid_password_reset_token');

    const credentialRows: {
      passwordResetOrganizationId: string | null;
      passwordResetTokenExpiresAt: Date | null;
      passwordResetTokenHash: string | null;
    }[] = await db
      .select({
        passwordResetOrganizationId: localCredentials.passwordResetOrganizationId,
        passwordResetTokenExpiresAt: localCredentials.passwordResetTokenExpiresAt,
        passwordResetTokenHash: localCredentials.passwordResetTokenHash,
      })
      .from(localCredentials)
      .where(eq(localCredentials.principalId, adminPrincipalId));
    expect(credentialRows[0]).toEqual({
      passwordResetOrganizationId: null,
      passwordResetTokenExpiresAt: null,
      passwordResetTokenHash: null,
    });

    const revokedSessionRows: { id: string; revokedAt: Date | null }[] = await db
      .select({
        id: authSessions.id,
        revokedAt: authSessions.revokedAt,
      })
      .from(authSessions)
      .where(eq(authSessions.principalId, adminPrincipalId));
    const revokedSessionIds: string[] = revokedSessionRows
      .filter((row: { id: string; revokedAt: Date | null }): boolean => row.revokedAt !== null)
      .map((row: { id: string; revokedAt: Date | null }): string => row.id);
    expect(revokedSessionIds).toEqual(expect.arrayContaining(preResetSessionIds));

    const revokedAppAccessRows: { revokedAt: Date | null }[] = await db
      .select({
        revokedAt: appAccessSessions.revokedAt,
      })
      .from(appAccessSessions)
      .where(eq(appAccessSessions.authSessionId, 'ses_old_reset'));
    expect(revokedAppAccessRows[0]?.revokedAt).not.toBeNull();
    expect(appAccessEdgeServiceMocks.invalidateEdgeAppAccessSessions.mock.calls).toEqual(
      expect.arrayContaining(preResetSessionIds.map((sessionId: string): [string] => [sessionId])),
    );

    const oldWhoAmIResponse: LightMyRequestResponse = await app.inject({
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
      },
      method: 'GET',
      url: '/v1/whoami',
    });
    expect(oldWhoAmIResponse.statusCode).toBe(401);
    expect(errorResponseSchema.parse(oldWhoAmIResponse.json()).error.code).toBe('unauthorized');

    const oldLoginResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      payload: {
        email: 'admin@example.com',
        password: 'supersecretpassword',
      },
      url: '/v1/auth/login',
    });
    expect(oldLoginResponse.statusCode).toBe(401);
    expect(errorResponseSchema.parse(oldLoginResponse.json()).error.code).toBe('invalid_credentials');

    const newLoginResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      payload: {
        email: 'admin@example.com',
        password: 'newsupersecretpassword',
      },
      url: '/v1/auth/login',
    });
    expect(newLoginResponse.statusCode).toBe(200);

    const passwordResetOperations: StoredOperationRow[] = (
      await db.select().from(operations).where(eq(operations.targetId, adminPrincipalId))
    ).filter((operation: StoredOperationRow): boolean => operation.type.startsWith('auth.password_reset.'));
    expect(passwordResetOperations.map((operation: StoredOperationRow): string => operation.type)).toEqual(
      expect.arrayContaining(['auth.password_reset.issue', 'auth.password_reset.complete']),
    );
  });

  it('returns not found when password reset issuance targets an unknown email', async (): Promise<void> => {
    await installCompartment(app);

    const response: LightMyRequestResponse = await systemApp.inject({
      headers: buildSystemAuthorizationHeaders(),
      method: 'POST',
      payload: {
        email: 'missing@example.com',
      },
      url: '/internal/system/auth/password-reset/issue',
    });

    expect(response.statusCode).toBe(404);
    expect(errorResponseSchema.parse(response.json()).error.code).toBe('password_reset_user_not_found');
  });
});

function requireRedirectTo(redirectTo: string | undefined): string {
  if (redirectTo === undefined) {
    throw new Error('Expected redirect target.');
  }

  return redirectTo;
}

function readDefaultBrowserOrigin(): string {
  return new URL(buildRuntimePublicSettings(defaultApiConfig).compartmentUrl).origin;
}

async function readResetPasswordFlowCookie(resetUrl: string): Promise<string> {
  const url: URL = new URL(resetUrl);
  const landingResponse: LightMyRequestResponse = await app.inject({
    method: 'GET',
    query: Object.fromEntries(url.searchParams.entries()),
    url: url.pathname,
  });
  expect(landingResponse.statusCode).toBe(302);

  return `__Host-compartment_credential_reset_flow=${requireSetCookieValue(
    landingResponse.headers['set-cookie'],
    '__Host-compartment_credential_reset_flow',
  )}`;
}

function buildBrowserCsrfHeaders(csrfToken: string): Record<string, string> {
  return {
    [compartmentCsrfHeaderName]: csrfToken,
    cookie: `${compartmentCsrfCookieName}=${csrfToken}`,
    host: defaultApiConfig.controlPlaneHost,
    origin: readDefaultBrowserOrigin(),
  };
}
