import {
  activateResponseSchema,
  compartmentSessionCookieName,
  deploymentStatusResponseSchema,
  deployResponseSchema,
  errorResponseSchema,
  loginResponseSchema,
  projectListResponseSchema,
  projectLifecycleResponseSchema,
  projectOverviewResponseSchema,
  projectReadResponseSchema,
  projectResponseSchema,
  inviteUserResponseSchema,
  type ActivateResponse,
  type DeploymentStatusResponse,
  type DeploymentSummary,
  type DeployResponse,
  type InviteUserResponse,
  type InstallResponse,
  type ProjectEnvironmentOverview,
  type ProjectListResponse,
  type ProjectOverviewResponse,
  type ProjectOverviewSummary,
  type ProjectReadResponse,
  type ProjectServiceOverview,
  type ProjectStatusSummary,
  type ProjectSummary,
  type ProjectLifecycleResponse,
  type ProjectResponse,
  type SourceUploadSummary,
  type WorkerClaimedDeployment,
  compartmentCsrfCookieName,
  compartmentCsrfHeaderName,
  compartmentCurrentOrganizationHeaderName,
  loginStateResponseSchema,
  type CompartmentAuthoredDescriptor,
} from '@compartment/contracts';
import type { LightMyRequestResponse } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { and, count, eq } from 'drizzle-orm';
import type { ApiApp } from '../src/app.types';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';

import {
  accessAssignments,
  accessRoles,
  appAccessCodes,
  appAccessSessions,
  buildArtifacts,
  deployments,
  environments,
  projectServices,
  projects,
  sourceUploads,
} from '../src/db/schema';
import {
  authApiActivatePathname,
  authApiLoginPathname,
  authApiLoginStatePathname,
} from '../src/routes/auth/auth-api-paths';

import { createBrowserCsrfCookie } from '../src/services/browser-csrf-cookie.service';
import { buildRuntimePublicSettings } from '../src/services/public-hosts.service';
import {
  acknowledgeKubeDeploymentStopped,
  claimNextQueuedDeployment,
  createUploadedSourceArchive,
  completeClaimedDeployment,
  completeQueuedDeployment,
  createSourceArchive,
  createMultiServiceDescriptor,
  createMultiServiceRoutes,
  injectDeployRequest,
  injectJsonDeployRequest,
  installCompartment,
  requireClaimedDeployment,
  requireClaimedDeploymentByServiceName,
  requireDeploymentByServiceName,
  requireDeployResponseDeployment,
  requireQueryParam,
  requireSetCookieValue,
  rollbackOpenTransaction,
  waitForConcurrentDatabaseWork,
} from './api-integration.harness';
import type { StoredDeploymentRow } from './api.integration.types';
import {
  createApiIntegrationApps,
  createApiIntegrationTestContext,
  cleanupApiIntegrationRuntime,
  cleanupApiIntegrationTempDirectory,
  configureApiRuntimeWithPublicIngress,
  resetApiIntegrationTempDirectory,
} from './api-app-test.harness';
import { useApiDatabaseTestHarness } from './api-db-test.harness';
import { createOrganizationMemberSession, readStoredAuthSessionIdByToken } from './api-auth-session-test.fixtures';

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

const {
  apiConfig: defaultApiConfig,
  databaseUrl: apiIntegrationDatabaseUrl,
  testTempDirectory,
} = createApiIntegrationTestContext('api_integration_projects', 'api-integration-projects');
let pool!: Pool;
let db!: Database;
let app!: ApiApp;
let systemApp!: ApiApp;
let hasInitializedApiIntegrationRuntime: boolean = false;

describe('Phase 0 API integration projects', (): void => {
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
  it('activates an invited member in the browser without app access and blocks protected CLI/API routes', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const deployPayload: DeployResponse = deployResponseSchema.parse(
      (await injectDeployRequest(app, installPayload.sessionToken, 'acme-dev')).json(),
    );
    const deployment: DeploymentSummary = requireDeployResponseDeployment(deployPayload);
    const claimedDeployment: WorkerClaimedDeployment = requireClaimedDeployment(await claimNextQueuedDeployment(app));
    await completeQueuedDeployment(app, deployment.id, claimedDeployment.routeHost);

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

    const activateResponse: LightMyRequestResponse = await app.inject({
      headers: buildBrowserCsrfHeaders(requireSetCookieValue(createBrowserCsrfCookie(), compartmentCsrfCookieName)),
      method: 'POST',
      payload: {
        bootstrapToken: activationToken,
        email: 'viewer@example.com',
        host: claimedDeployment.routeHost,
        password: 'viewersecretpassword',
        path: '/dashboard',
        sessionDelivery: 'cookie',
        state: 'viewer-flow',
      },
      url: authApiActivatePathname,
    });
    expect(activateResponse.statusCode).toBe(200);
    expect(String(activateResponse.headers['set-cookie'])).toContain(`${compartmentSessionCookieName}=`);
    const viewerSessionToken: string = requireSetCookieValue(
      activateResponse.headers['set-cookie'],
      compartmentSessionCookieName,
    );

    const activatePayload: ActivateResponse = activateResponseSchema.parse(activateResponse.json());
    expect(activatePayload.redirectTo).toBe('/orgs/acme-dev/projects');
    const viewerSessionId: string = await readStoredAuthSessionIdByToken(
      db,
      viewerSessionToken,
      defaultApiConfig.sessionSecret,
    );
    const appAccessCodeRows: { value: number }[] = await db
      .select({ value: count() })
      .from(appAccessCodes)
      .where(
        and(eq(appAccessCodes.authSessionId, viewerSessionId), eq(appAccessCodes.host, claimedDeployment.routeHost)),
      );
    expect(appAccessCodeRows[0]?.value).toBe(0);

    const viewerHeaders: Record<string, string> = {
      authorization: `Bearer ${viewerSessionToken}`,
      [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
    };

    const projectListResponse: LightMyRequestResponse = await app.inject({
      headers: viewerHeaders,
      method: 'GET',
      url: '/v1/projects',
    });
    expect(projectListResponse.statusCode).toBe(200);
    expect(projectListResponseSchema.parse(projectListResponse.json()).projects).toHaveLength(0);

    const statusResponse: LightMyRequestResponse = await app.inject({
      headers: viewerHeaders,
      method: 'GET',
      url: '/v1/deployments/status?projectName=smoke-web',
    });
    expect(statusResponse.statusCode).toBe(403);
    expect(errorResponseSchema.parse(statusResponse.json()).error.code).toBe('forbidden');

    const logsResponse: LightMyRequestResponse = await app.inject({
      headers: viewerHeaders,
      method: 'GET',
      url: '/v1/deployments/logs?projectName=smoke-web',
    });
    expect(logsResponse.statusCode).toBe(403);
    expect(errorResponseSchema.parse(logsResponse.json()).error.code).toBe('forbidden');

    const inspectResponse: LightMyRequestResponse = await app.inject({
      headers: viewerHeaders,
      method: 'GET',
      url: '/v1/deployments/inspect?projectName=smoke-web',
    });
    expect(inspectResponse.statusCode).toBe(403);
    expect(errorResponseSchema.parse(inspectResponse.json()).error.code).toBe('forbidden');

    const listResponse: LightMyRequestResponse = await app.inject({
      headers: viewerHeaders,
      method: 'GET',
      url: '/v1/deployments?projectName=smoke-web',
    });
    expect(listResponse.statusCode).toBe(403);
    expect(errorResponseSchema.parse(listResponse.json()).error.code).toBe('forbidden');

    const promoteResponse: LightMyRequestResponse = await app.inject({
      headers: viewerHeaders,
      method: 'POST',
      payload: {
        projectName: 'smoke-web',
        sourceEnvironmentName: 'production',
        targetEnvironmentName: 'staging',
      },
      url: '/v1/deployments/promote',
    });
    expect(promoteResponse.statusCode).toBe(403);
    expect(errorResponseSchema.parse(promoteResponse.json()).error.code).toBe('forbidden');

    const rollbackResponse: LightMyRequestResponse = await app.inject({
      headers: viewerHeaders,
      method: 'POST',
      payload: {
        environmentName: 'production',
        projectName: 'smoke-web',
        serviceName: 'web',
      },
      url: '/v1/deployments/rollback',
    });
    expect(rollbackResponse.statusCode).toBe(403);
    expect(errorResponseSchema.parse(rollbackResponse.json()).error.code).toBe('forbidden');

    const deployResponse: LightMyRequestResponse = await injectDeployRequest(app, viewerSessionToken, 'acme-dev');
    expect(deployResponse.statusCode).toBe(403);
    expect(errorResponseSchema.parse(deployResponse.json()).error.code).toBe('forbidden');
  });

  it('does not mint app access credentials from login state without app route access', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const deployPayload: DeployResponse = deployResponseSchema.parse(
      (await injectDeployRequest(app, installPayload.sessionToken, 'acme-dev')).json(),
    );
    const deployment: DeploymentSummary = requireDeployResponseDeployment(deployPayload);
    const claimedDeployment: WorkerClaimedDeployment = requireClaimedDeployment(await claimNextQueuedDeployment(app));
    await completeQueuedDeployment(app, deployment.id, claimedDeployment.routeHost);
    const memberSessionToken: string = await createOrganizationMemberSession({
      assignRole: false,
      db,
      email: 'member-no-app-access@example.com',
      organizationId: installPayload.organization.id,
      principalId: 'prn_member_no_app_access',
      role: 'viewer',
      sessionId: 'ses_member_no_app_access',
      sessionSecret: defaultApiConfig.sessionSecret,
      sessionToken: 'member-no-app-access-session-token',
    });

    const loginStateResponse: LightMyRequestResponse = await app.inject({
      headers: {
        cookie: `${compartmentSessionCookieName}=${memberSessionToken}`,
      },
      method: 'GET',
      query: {
        host: claimedDeployment.routeHost,
        path: '/dashboard',
        state: 'member-flow',
      },
      url: authApiLoginStatePathname,
    });

    expect(loginStateResponse.statusCode).toBe(200);
    expect(loginStateResponseSchema.parse(loginStateResponse.json()).view).toBe('methods');
    const codeRows: { value: number }[] = await db
      .select({ value: count() })
      .from(appAccessCodes)
      .where(
        and(
          eq(appAccessCodes.authSessionId, 'ses_member_no_app_access'),
          eq(appAccessCodes.host, claimedDeployment.routeHost),
        ),
      );
    const sessionRows: { value: number }[] = await db
      .select({ value: count() })
      .from(appAccessSessions)
      .where(
        and(
          eq(appAccessSessions.authSessionId, 'ses_member_no_app_access'),
          eq(appAccessSessions.host, claimedDeployment.routeHost),
        ),
      );

    expect(codeRows[0]?.value).toBe(0);
    expect(sessionRows[0]?.value).toBe(0);
  });

  it('does not exchange an app access code after app route access is revoked', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const deployPayload: DeployResponse = deployResponseSchema.parse(
      (await injectDeployRequest(app, installPayload.sessionToken, 'acme-dev')).json(),
    );
    const deployment: DeploymentSummary = requireDeployResponseDeployment(deployPayload);
    const claimedDeployment: WorkerClaimedDeployment = requireClaimedDeployment(await claimNextQueuedDeployment(app));
    await completeQueuedDeployment(app, deployment.id, claimedDeployment.routeHost);
    const adminSessionId: string = await readStoredAuthSessionIdByToken(
      db,
      installPayload.sessionToken,
      defaultApiConfig.sessionSecret,
    );
    const loginStateResponse: LightMyRequestResponse = await app.inject({
      headers: {
        cookie: `${compartmentSessionCookieName}=${installPayload.sessionToken}`,
      },
      method: 'GET',
      query: {
        host: claimedDeployment.routeHost,
        path: '/dashboard',
        state: 'admin-flow',
      },
      url: authApiLoginStatePathname,
    });
    const callbackUrl: URL = new URL(
      requireRedirectTo(loginStateResponseSchema.parse(loginStateResponse.json()).redirectTo),
    );
    const appAccessCode: string = requireQueryParam(callbackUrl, 'code');

    await db.delete(accessAssignments).where(eq(accessAssignments.organizationId, installPayload.organization.id));

    const exchangeResponse: LightMyRequestResponse = await app.inject({
      headers: {
        authorization: 'Bearer test-edge-token',
      },
      method: 'POST',
      payload: {
        code: appAccessCode,
        host: claimedDeployment.routeHost,
        state: 'admin-flow',
      },
      url: '/internal/app-access/exchange',
    });
    const codeRows: { consumedAt: Date | null }[] = await db
      .select({ consumedAt: appAccessCodes.consumedAt })
      .from(appAccessCodes)
      .where(
        and(eq(appAccessCodes.authSessionId, adminSessionId), eq(appAccessCodes.host, claimedDeployment.routeHost)),
      );
    const sessionRows: { value: number }[] = await db
      .select({ value: count() })
      .from(appAccessSessions)
      .where(
        and(
          eq(appAccessSessions.authSessionId, adminSessionId),
          eq(appAccessSessions.host, claimedDeployment.routeHost),
        ),
      );

    expect(exchangeResponse.statusCode).toBe(401);
    expect(errorResponseSchema.parse(exchangeResponse.json()).error.code).toBe('invalid_app_access_code');
    expect(codeRows).toEqual([{ consumedAt: null }]);
    expect(sessionRows[0]?.value).toBe(0);
  });

  it('does not mint app access credentials when the login path targets an inaccessible proxy route', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const sourceUpload: SourceUploadSummary = await createUploadedSourceArchive(
      app,
      installPayload.sessionToken,
      'acme-dev',
      await createSourceArchive({
        'compartment.routes.yml':
          'version: 1\n\nroutes:\n  - on: web\n    path: /api/*\n    to: backoffice\n    stripPrefix: /api\n',
        'compartment.yml':
          'name: smoke-multi-service\nservices:\n  backoffice:\n    path: ./services/backoffice\n  web:\n    accessMode: public\n    path: ./services/web\n',
        'services/backoffice/package.json': '{"name":"backoffice"}\n',
        'services/web/package.json': '{"name":"web"}\n',
        'package.json': '{"name":"root"}\n',
      }),
    );
    const publicWebDescriptor: CompartmentAuthoredDescriptor = {
      name: 'smoke-multi-service',
      services: {
        backoffice: {
          kind: 'api',
          path: './services/backoffice',
          readiness: {
            path: '/ready',
            timeoutMs: 30000,
            type: 'http',
          },
        },
        web: {
          accessMode: 'public',
          path: './services/web',
          readiness: {
            path: '/healthz',
            timeoutMs: 30000,
            type: 'http',
          },
        },
      },
    };
    const deployResponse: LightMyRequestResponse = await injectJsonDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      {
        descriptor: publicWebDescriptor,
        projectName: 'smoke-multi-service',
        routes: createMultiServiceRoutes(),
        sourceUploadId: sourceUpload.id,
      },
    );
    const deployPayload: DeployResponse = deployResponseSchema.parse(deployResponse.json());
    const webDeployment: DeploymentSummary = requireDeploymentByServiceName(deployPayload.deployments, 'web');
    const backofficeDeployment: DeploymentSummary = requireDeploymentByServiceName(
      deployPayload.deployments,
      'backoffice',
    );
    const claimedDeployments: WorkerClaimedDeployment[] = [
      requireClaimedDeployment(await claimNextQueuedDeployment(app)),
      requireClaimedDeployment(await claimNextQueuedDeployment(app)),
    ];
    const webRouteHost: string = requireClaimedDeploymentByServiceName(claimedDeployments, 'web').routeHost;
    await completeClaimedDeployment(app, webDeployment.id, webRouteHost);
    await completeClaimedDeployment(
      app,
      backofficeDeployment.id,
      requireClaimedDeploymentByServiceName(claimedDeployments, 'backoffice').routeHost,
    );
    const memberSessionToken: string = await createOrganizationMemberSession({
      assignRole: false,
      db,
      email: 'proxy-member-no-app-access@example.com',
      organizationId: installPayload.organization.id,
      principalId: 'prn_proxy_member_no_app_access',
      role: 'viewer',
      sessionId: 'ses_proxy_member_no_app_access',
      sessionSecret: defaultApiConfig.sessionSecret,
      sessionToken: 'proxy-member-no-app-access-session-token',
    });

    const loginStateResponse: LightMyRequestResponse = await app.inject({
      headers: {
        cookie: `${compartmentSessionCookieName}=${memberSessionToken}`,
      },
      method: 'GET',
      query: {
        host: webRouteHost,
        path: '/api/private',
        state: 'proxy-flow',
      },
      url: authApiLoginStatePathname,
    });
    const codeRows: { value: number }[] = await db
      .select({ value: count() })
      .from(appAccessCodes)
      .where(
        and(eq(appAccessCodes.authSessionId, 'ses_proxy_member_no_app_access'), eq(appAccessCodes.host, webRouteHost)),
      );

    expect(loginStateResponse.statusCode).toBe(200);
    expect(loginStateResponseSchema.parse(loginStateResponse.json()).view).toBe('methods');
    expect(codeRows[0]?.value).toBe(0);
  });

  it('keeps one admin when a concurrent membership change removes the other admin first', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const secondAdminInvite: InviteUserResponse = inviteUserResponseSchema.parse(
      (
        await app.inject({
          method: 'POST',
          payload: {
            email: 'second-admin@example.com',
          },
          url: '/v1/users',
          headers: {
            authorization: `Bearer ${installPayload.sessionToken}`,
            [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
          },
        })
      ).json(),
    );
    await seedOrganizationSystemRoleAssignment(secondAdminInvite.user.id, installPayload.organization.id, 'admin');
    const organizationLockClient: PoolClient = await pool.connect();

    try {
      await organizationLockClient.query('BEGIN');
      await organizationLockClient.query('select id from organizations where id = $1 for update', [
        installPayload.organization.id,
      ]);
      await organizationLockClient.query(
        `delete from access_assignments
         where organization_id = $1
           and subject_type = 'principal'
           and scope_type = 'organization'
           and scope_id = $1
           and subject_id = (select id from principals where email = $2)
           and role_id = (select id from access_roles where organization_id = $1 and name = 'admin')`,
        [installPayload.organization.id, 'admin@example.com'],
      );

      const removeSecondAdminResponsePromise: Promise<LightMyRequestResponse> = app.inject({
        method: 'DELETE',
        url: `/v1/users/${encodeURIComponent('second-admin@example.com')}`,
        headers: {
          authorization: `Bearer ${installPayload.sessionToken}`,
          [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
        },
      });

      await waitForConcurrentDatabaseWork();
      await organizationLockClient.query('COMMIT');

      const removeSecondAdminResponse: LightMyRequestResponse = await removeSecondAdminResponsePromise;
      const remainingAdminCount: number = await countOrganizationRoleAssignments(
        installPayload.organization.id,
        'admin',
      );

      expect(removeSecondAdminResponse.statusCode).toBe(409);
      expect(errorResponseSchema.parse(removeSecondAdminResponse.json()).error.code).toBe('last_organization_admin');
      expect(remainingAdminCount).toBe(1);
    } finally {
      await rollbackOpenTransaction(organizationLockClient);
      organizationLockClient.release();
    }
  });
  it('reuses project context rows for concurrent deploy requests with the same canonical keys', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const [firstDeployResponse, secondDeployResponse]: [LightMyRequestResponse, LightMyRequestResponse] =
      await Promise.all([
        injectDeployRequest(app, installPayload.sessionToken, 'acme-dev'),
        injectDeployRequest(app, installPayload.sessionToken, 'acme-dev'),
      ]);

    expect([firstDeployResponse.statusCode, secondDeployResponse.statusCode]).toEqual([200, 200]);
    deployResponseSchema.parse(firstDeployResponse.json());
    deployResponseSchema.parse(secondDeployResponse.json());

    const storedProjectsCount: { value: number }[] = await db.select({ value: count() }).from(projects);
    const storedProjectServicesCount: { value: number }[] = await db.select({ value: count() }).from(projectServices);
    const storedEnvironmentsCount: { value: number }[] = await db.select({ value: count() }).from(environments);

    expect(storedProjectsCount[0]?.value).toBe(1);
    expect(storedProjectServicesCount[0]?.value).toBe(1);
    expect(storedEnvironmentsCount[0]?.value).toBe(1);
  });
  it('reuses and retains a shared source upload across a multi-service deployment batch', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const sourceUpload: SourceUploadSummary = await createUploadedSourceArchive(
      app,
      installPayload.sessionToken,
      'acme-dev',
      await createSourceArchive({
        'compartment.routes.yml':
          'version: 1\n\nroutes:\n  - on: web\n    path: /api/*\n    to: backoffice\n    stripPrefix: /api\n',
        'compartment.yml':
          'name: smoke-multi-service\nservices:\n  backoffice:\n    path: ./services/backoffice\n  web:\n    path: ./services/web\n',
        'services/backoffice/package.json': '{"name":"backoffice"}\n',
        'services/web/package.json': '{"name":"web"}\n',
        'package.json': '{"name":"root"}\n',
      }),
    );

    const deployResponse: LightMyRequestResponse = await injectJsonDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      {
        descriptor: createMultiServiceDescriptor(),
        projectName: 'smoke-multi-service',
        routes: createMultiServiceRoutes(),
        sourceUploadId: sourceUpload.id,
      },
    );

    expect(deployResponse.statusCode).toBe(200);
    const deployPayload: DeployResponse = deployResponseSchema.parse(deployResponse.json());
    const webDeployment: DeploymentSummary = requireDeploymentByServiceName(deployPayload.deployments, 'web');
    const backofficeDeployment: DeploymentSummary = requireDeploymentByServiceName(
      deployPayload.deployments,
      'backoffice',
    );
    const storedArtifacts: (typeof buildArtifacts.$inferSelect)[] = await db.select().from(buildArtifacts);
    const claimedDeployments: WorkerClaimedDeployment[] = [
      requireClaimedDeployment(await claimNextQueuedDeployment(app)),
      requireClaimedDeployment(await claimNextQueuedDeployment(app)),
    ];

    expect(deployPayload.deployments).toHaveLength(2);
    expect(storedArtifacts).toHaveLength(2);
    expect(requireClaimedDeploymentByServiceName(claimedDeployments, 'web').service.name).toBe('web');
    expect(requireClaimedDeploymentByServiceName(claimedDeployments, 'backoffice').service.name).toBe('backoffice');
    expect(
      new Set(
        storedArtifacts.map((artifact: typeof buildArtifacts.$inferSelect): string | null => artifact.sourceUploadId),
      ),
    ).toEqual(new Set([sourceUpload.id]));
    expect(await db.select().from(sourceUploads)).toHaveLength(1);

    await completeClaimedDeployment(app, webDeployment.id, 'smoke-multi-service.localhost');
    expect(await db.select().from(sourceUploads)).toHaveLength(1);

    await completeClaimedDeployment(app, backofficeDeployment.id, 'backoffice-smoke-multi-service.localhost');
    expect(await db.select().from(sourceUploads)).toHaveLength(1);
  });
  it('keeps a shared source upload for the successful deployment in a mixed-outcome batch', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const sourceUpload: SourceUploadSummary = await createUploadedSourceArchive(
      app,
      installPayload.sessionToken,
      'acme-dev',
      await createSourceArchive({
        'compartment.routes.yml':
          'version: 1\n\nroutes:\n  - on: web\n    path: /api/*\n    to: backoffice\n    stripPrefix: /api\n',
        'compartment.yml':
          'name: smoke-multi-service\nservices:\n  backoffice:\n    path: ./services/backoffice\n  web:\n    path: ./services/web\n',
        'services/backoffice/package.json': '{"name":"backoffice"}\n',
        'services/web/package.json': '{"name":"web"}\n',
        'package.json': '{"name":"root"}\n',
      }),
    );

    const deployResponse: LightMyRequestResponse = await injectJsonDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      {
        descriptor: createMultiServiceDescriptor(),
        projectName: 'smoke-multi-service',
        routes: createMultiServiceRoutes(),
        sourceUploadId: sourceUpload.id,
      },
    );

    expect(deployResponse.statusCode).toBe(200);
    const deployPayload: DeployResponse = deployResponseSchema.parse(deployResponse.json());
    const webDeployment: DeploymentSummary = requireDeploymentByServiceName(deployPayload.deployments, 'web');
    const backofficeDeployment: DeploymentSummary = requireDeploymentByServiceName(
      deployPayload.deployments,
      'backoffice',
    );
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

    expect(webDeployment.id).toBe(claimedWebDeployment.deploymentId);
    expect(backofficeDeployment.id).toBe(claimedBackofficeDeployment.deploymentId);

    const failedResponse: LightMyRequestResponse = await app.inject({
      headers: {
        authorization: 'Bearer test-runtime-control-token',
      },
      method: 'POST',
      payload: {
        deploymentId: webDeployment.id,
        message: 'build failed before image publish',
      },
      url: '/internal/deployments/fail',
    });
    expect(failedResponse.statusCode).toBe(200);
    expect(await db.select().from(sourceUploads)).toHaveLength(1);

    const remainingArchiveResponse: LightMyRequestResponse = await app.inject({
      headers: {
        authorization: 'Bearer test-runtime-control-token',
      },
      method: 'GET',
      url: `/internal/artifacts/${claimedBackofficeDeployment.artifact.id}/source-archive`,
    });
    expect(remainingArchiveResponse.statusCode).toBe(200);

    await completeClaimedDeployment(app, backofficeDeployment.id, claimedBackofficeDeployment.routeHost);
    expect(await db.select().from(sourceUploads)).toHaveLength(1);

    const retainedArchiveResponse: LightMyRequestResponse = await app.inject({
      headers: {
        authorization: 'Bearer test-runtime-control-token',
      },
      method: 'GET',
      url: `/internal/artifacts/${claimedBackofficeDeployment.artifact.id}/source-archive`,
    });
    expect(retainedArchiveResponse.statusCode).toBe(200);
  });
  it('lists, renames, archives, and unarchives projects inside the current organization', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const deployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
    );
    expect(deployResponse.statusCode).toBe(200);
    const deployPayload: DeployResponse = deployResponseSchema.parse(deployResponse.json());
    const deployment: DeploymentSummary = requireDeployResponseDeployment(deployPayload);
    await completeQueuedDeployment(app, deployment.id);

    const listResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/projects',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(listResponse.statusCode).toBe(200);
    const listPayload: ProjectListResponse = projectListResponseSchema.parse(listResponse.json());
    if (listPayload.detail !== 'summary') {
      throw new Error('Expected summary project list.');
    }
    expect(listPayload.projects).toHaveLength(1);
    expect(listPayload.projects[0]?.name).toBe('smoke-web');
    expect(listPayload.projects[0]?.archivedAt).toBeNull();

    const browserCsrfToken: string = requireSetCookieValue(createBrowserCsrfCookie(), compartmentCsrfCookieName);
    const browserLoginResponse: LightMyRequestResponse = await app.inject({
      headers: buildBrowserCsrfHeaders(browserCsrfToken),
      method: 'POST',
      payload: {
        email: 'admin@example.com',
        password: 'supersecretpassword',
        sessionDelivery: 'cookie',
      },
      url: authApiLoginPathname,
    });
    expect(browserLoginResponse.statusCode).toBe(200);
    expect(loginResponseSchema.parse(browserLoginResponse.json()).redirectTo).toBe('/orgs/acme-dev/projects');
    const browserSessionToken: string = requireSetCookieValue(
      browserLoginResponse.headers['set-cookie'],
      compartmentSessionCookieName,
    );
    const browserCookieHeader: string = `${compartmentSessionCookieName}=${browserSessionToken}; ${compartmentCsrfCookieName}=${browserCsrfToken}`;
    const browserOrigin: string = readDefaultBrowserOrigin();

    const browserListResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/projects?detail=overview',
      headers: {
        cookie: `${compartmentSessionCookieName}=${browserSessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(browserListResponse.statusCode).toBe(200);
    expect(projectListResponseSchema.parse(browserListResponse.json()).projects).toHaveLength(1);

    const browserRenameResponse: LightMyRequestResponse = await app.inject({
      method: 'PATCH',
      payload: {
        name: 'browser-renamed-web',
      },
      url: '/v1/projects/smoke-web',
      headers: {
        [compartmentCsrfHeaderName]: browserCsrfToken,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
        cookie: browserCookieHeader,
        host: defaultApiConfig.controlPlaneHost,
        origin: browserOrigin,
      },
    });
    expect(browserRenameResponse.statusCode).toBe(200);
    expect(projectResponseSchema.parse(browserRenameResponse.json()).project.name).toBe('browser-renamed-web');

    const browserRenameBackResponse: LightMyRequestResponse = await app.inject({
      method: 'PATCH',
      payload: {
        name: 'smoke-web',
      },
      url: '/v1/projects/browser-renamed-web',
      headers: {
        [compartmentCsrfHeaderName]: browserCsrfToken,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
        cookie: browserCookieHeader,
        host: defaultApiConfig.controlPlaneHost,
        origin: browserOrigin,
      },
    });
    expect(browserRenameBackResponse.statusCode).toBe(200);
    expect(projectResponseSchema.parse(browserRenameBackResponse.json()).project.name).toBe('smoke-web');

    const overviewListResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/projects?detail=overview&orderBy=serviceCount&sort=desc&page=1&perPage=10',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(overviewListResponse.statusCode).toBe(200);
    const overviewListPayload: ProjectListResponse = projectListResponseSchema.parse(overviewListResponse.json());
    if (overviewListPayload.detail !== 'overview') {
      throw new Error('Expected overview project list.');
    }
    expect(overviewListPayload.detail).toBe('overview');
    expect(overviewListPayload.pagination).toEqual({
      page: 1,
      perPage: 10,
      totalItems: 1,
      totalPages: 1,
    });
    const overviewProject: ProjectOverviewSummary = requireProjectOverviewSummary(overviewListPayload.projects[0]);
    expect(overviewProject.serviceCount).toBe(1);
    expect(overviewProject.status).toBe('healthy');
    expect(overviewProject.routeUrl).toContain('smoke-web');
    expect(overviewProject.canManageArchive).toBe(true);
    expect(overviewProject.canReadDeployments).toBe(true);
    expect(overviewProject.canManageLifecycle).toBe(true);
    expect(overviewProject.openTargets).toEqual([
      expect.objectContaining({
        environmentName: 'production',
        serviceName: 'web',
      }),
    ]);

    const statusListResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: `/v1/projects?detail=status&projectIds=${encodeURIComponent(overviewProject.id)}`,
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(statusListResponse.statusCode).toBe(200);
    const statusListPayload: ProjectListResponse = projectListResponseSchema.parse(statusListResponse.json());
    expect(statusListPayload.detail).toBe('status');
    const statusProject: ProjectStatusSummary = requireProjectStatusSummary(statusListPayload.projects[0]);
    expect(statusProject.id).toBe(overviewProject.id);
    expect(statusProject.status).toBe('healthy');
    expect(statusProject.lifecycleState).toBe('running');
    expect(statusProject.routeUrl).toContain('smoke-web');
    expect(statusProject.openTargets).toEqual(overviewProject.openTargets);

    const projectOverviewResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/projects/smoke-web/overview',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(projectOverviewResponse.statusCode).toBe(200);
    const projectOverviewPayload: ProjectOverviewResponse = projectOverviewResponseSchema.parse(
      projectOverviewResponse.json(),
    );
    expect(projectOverviewPayload.project.id).toBe(overviewProject.id);
    expect(projectOverviewPayload.project.canReadDeployments).toBe(true);
    expect(projectOverviewPayload.project.openTargets).toEqual(overviewProject.openTargets);
    expect(projectOverviewPayload.environments).toHaveLength(1);
    const environmentOverview: ProjectEnvironmentOverview | undefined = projectOverviewPayload.environments[0];
    expect(environmentOverview?.name).toBe('production');
    expect(environmentOverview?.status).toBe('healthy');
    expect(environmentOverview?.services).toHaveLength(1);
    const serviceOverview: ProjectServiceOverview | undefined = environmentOverview?.services[0];
    expect(serviceOverview?.kind).toBe('web');
    expect(serviceOverview?.lastDeploymentCreatedAt).not.toBeNull();
    expect(serviceOverview?.name).toBe('web');
    expect(serviceOverview?.routeUrl).toContain('smoke-web');
    expect(serviceOverview?.status).toBe('healthy');

    const showResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/projects/smoke-web',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(showResponse.statusCode).toBe(200);
    const showPayload: ProjectReadResponse = projectReadResponseSchema.parse(showResponse.json());
    expect(showPayload.project.name).toBe('smoke-web');
    expect(showPayload.remoteState).toBe('active');

    const renameResponse: LightMyRequestResponse = await app.inject({
      method: 'PATCH',
      url: '/v1/projects/smoke-web',
      payload: {
        name: 'renamed-web',
      },
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(renameResponse.statusCode).toBe(200);
    const renamePayload: ProjectResponse = projectResponseSchema.parse(renameResponse.json());
    expect(renamePayload.project.name).toBe('renamed-web');

    const archiveResponsePromise: Promise<LightMyRequestResponse> = app.inject({
      method: 'POST',
      url: '/v1/projects/renamed-web/archive',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    await acknowledgeKubeDeploymentStopped(deployment.id);
    const archiveResponse: LightMyRequestResponse = await archiveResponsePromise;
    expect(archiveResponse.statusCode).toBe(200);
    const archivePayload: ProjectResponse = projectResponseSchema.parse(archiveResponse.json());
    expect(archivePayload.project.archivedAt).not.toBeNull();
    const storedDeployments: StoredDeploymentRow[] = await db.select().from(deployments);
    expect(storedDeployments[0]?.isActive).toBe(false);
    expect(storedDeployments[0]?.health).toBe('healthy');
    expect(storedDeployments[0]?.promotionStage).toBe('stopped');
    expect(storedDeployments[0]?.status).toBe('stopped');

    const archivedListResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/projects?archiveState=all',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(archivedListResponse.statusCode).toBe(200);
    const archivedListPayload: ProjectListResponse = projectListResponseSchema.parse(archivedListResponse.json());
    if (archivedListPayload.detail !== 'summary') {
      throw new Error('Expected summary project list.');
    }
    expect(archivedListPayload.projects).toHaveLength(1);
    expect(archivedListPayload.projects[0]?.name).toBe('renamed-web');
    expect(archivedListPayload.projects[0]?.archivedAt).not.toBeNull();

    const activeListResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/projects',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(activeListResponse.statusCode).toBe(200);
    expect(projectListResponseSchema.parse(activeListResponse.json()).projects).toHaveLength(0);

    const archivedShowResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/projects/renamed-web',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(archivedShowResponse.statusCode).toBe(409);

    const archivedRenameResponse: LightMyRequestResponse = await app.inject({
      method: 'PATCH',
      url: '/v1/projects/renamed-web',
      payload: {
        name: 'renamed-again',
      },
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(archivedRenameResponse.statusCode).toBe(409);

    const archivedDeployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      'renamed-web',
    );
    expect(archivedDeployResponse.statusCode).toBe(409);

    const unarchiveResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: '/v1/projects/renamed-web/unarchive',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(unarchiveResponse.statusCode).toBe(200);
    const unarchivePayload: ProjectResponse = projectResponseSchema.parse(unarchiveResponse.json());
    expect(unarchivePayload.project.archivedAt).toBeNull();

    const statusAfterUnarchiveResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/deployments/status?projectName=renamed-web',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(statusAfterUnarchiveResponse.statusCode).toBe(200);
    const statusAfterUnarchivePayload: DeploymentStatusResponse = deploymentStatusResponseSchema.parse(
      statusAfterUnarchiveResponse.json(),
    );
    expect(statusAfterUnarchivePayload.activeDeployments).toEqual([]);

    const startAfterUnarchiveResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: '/v1/projects/renamed-web/start',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(startAfterUnarchiveResponse.statusCode).toBe(200);
    const startAfterUnarchivePayload: ProjectLifecycleResponse = projectLifecycleResponseSchema.parse(
      startAfterUnarchiveResponse.json(),
    );
    expect(startAfterUnarchivePayload.action).toBe('start');
    expect(startAfterUnarchivePayload.state).toBe('updating');
  });
});

async function seedOrganizationSystemRoleAssignment(
  principalId: string,
  organizationId: string,
  roleName: 'admin' | 'deployer' | 'readonly' | 'viewer',
): Promise<void> {
  const roleId: string = await readOrganizationRoleId(organizationId, roleName);

  await db.insert(accessAssignments).values({
    id: `asg_${principalId}_${roleName}`,
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

async function countOrganizationRoleAssignments(
  organizationId: string,
  roleName: 'admin' | 'deployer' | 'readonly' | 'viewer',
): Promise<number> {
  const rows: { value: number }[] = await db
    .select({ value: count() })
    .from(accessAssignments)
    .innerJoin(accessRoles, eq(accessRoles.id, accessAssignments.roleId))
    .where(
      and(
        eq(accessAssignments.organizationId, organizationId),
        eq(accessAssignments.scopeType, 'organization'),
        eq(accessAssignments.scopeId, organizationId),
        eq(accessAssignments.subjectType, 'principal'),
        eq(accessRoles.name, roleName),
      ),
    );

  return rows[0]?.value ?? 0;
}

function requireProjectOverviewSummary(
  project: ProjectOverviewSummary | ProjectSummary | undefined,
): ProjectOverviewSummary {
  if (project === undefined || !('serviceCount' in project)) {
    throw new Error('Expected a project overview summary.');
  }

  return project;
}

function requireProjectStatusSummary(
  project: ProjectOverviewSummary | ProjectStatusSummary | ProjectSummary | undefined,
): ProjectStatusSummary {
  if (project === undefined || !('lifecycleState' in project) || 'serviceCount' in project) {
    throw new Error('Expected a project status summary.');
  }

  return project;
}

function requireRedirectTo(redirectTo: string | undefined): string {
  if (redirectTo === undefined) {
    throw new Error('Expected redirect target.');
  }

  return redirectTo;
}

function readDefaultBrowserOrigin(): string {
  return new URL(buildRuntimePublicSettings(defaultApiConfig).compartmentUrl).origin;
}

function buildBrowserCsrfHeaders(csrfToken: string): Record<string, string> {
  return {
    [compartmentCsrfHeaderName]: csrfToken,
    cookie: `${compartmentCsrfCookieName}=${csrfToken}`,
    host: defaultApiConfig.controlPlaneHost,
    origin: readDefaultBrowserOrigin(),
  };
}
