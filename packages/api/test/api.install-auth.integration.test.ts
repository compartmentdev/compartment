import {
  compartmentSessionCookieName,
  createOrganizationResponseSchema,
  errorResponseSchema,
  installResponseSchema,
  loginResponseSchema,
  systemDomainMutationResponseSchema,
  systemDomainStatusResponseSchema,
  type DomainDnsRecord,
  type DomainDnsRecordPurpose,
  type DomainDnsRecordType,
  type InstallResponse,
  type SystemDomainMutationResponse,
  type SystemDomainSetRequest,
  type SystemDomainStatusResponse,
  compartmentCsrfCookieName,
  compartmentCsrfHeaderName,
  compartmentCurrentOrganizationHeaderName,
  type CreateOrganizationResponse,
  type WhoAmIResponse,
  whoamiResponseSchema,
} from '@compartment/contracts';
import {
  buildCompartmentConsoleOrganizationProjectDeploymentDetailsPathname as buildBrowserOrganizationProjectDeploymentDetailsPathname,
  buildCompartmentConsoleOrganizationProjectsPathname as buildBrowserOrganizationProjectsPathname,
} from '@compartment/contracts/browser';
import type { LightMyRequestResponse } from 'fastify';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { and, count, eq } from 'drizzle-orm';
import {
  createBrowserCookieSession as createBrowserCookieSessionFixture,
  createOrganizationMemberSession as createOrganizationMemberSessionFixture,
  createStoredAppAccessSession as createStoredAppAccessSessionFixture,
  createStoredSsoOidcProvider as createStoredSsoOidcProviderFixture,
  readStoredAppAccessSession as readStoredAppAccessSessionFixture,
  readStoredAuthSession as readStoredAuthSessionFixture,
  type StoredBrowserSession,
} from './api-auth-session-test.fixtures';
import type { ApiApp } from '../src/app.types';
import type { ApiConfig } from '../src/config';
import type * as OutboundHttpService from '../src/services/outbound-http.service';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';

import {
  accessAssignments,
  accessRoles,
  authSessions,
  ssoOidcIdentities,
  operations,
  organizationMemberships,
  organizations,
  principals,
} from '../src/db/schema';
import { hashToken } from '../src/lib/tokens';
import { configureApiRuntime } from '../src/runtime/runtime';
import {
  authApiLoginPathname,
  authApiLoginStatePathname,
  authApiLogoutPathname,
} from '../src/routes/auth/auth-api-paths';
import { browserLoginPathname, browserLogoutPathname } from '../src/browser-public-paths';
import { createBrowserCsrfCookie } from '../src/services/browser-csrf-cookie.service';
import { buildRuntimePublicSettings } from '../src/services/public-hosts.service';
import {
  buildSystemAuthorizationHeaders,
  buildInstallAuthorizationHeaders,
  buildOrganizationAuthorizationHeaders,
  injectDeployRequest,
  installCompartment,
  requireSetCookieValue,
} from './api-integration.harness';
import type { StoredOperationRow } from './api.integration.types';
import {
  createApiIntegrationApps,
  createApiIntegrationTestContext,
  createEmptyPublicIngressConfig,
  createManagedPublicIngressConfig,
  mismatchedPublicIpv4Address,
  publicIpv4Address,
  cleanupApiIntegrationRuntime,
  cleanupApiIntegrationTlsDirectory,
  configureApiRuntimeWithPublicIngress,
  resetApiIntegrationTlsDirectory,
} from './api-app-test.harness';
import { useApiDatabaseTestHarness } from './api-db-test.harness';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';
import { expectNoStoreCacheControlHeader } from './response-cache-test.helpers';

type InvalidateEdgeAppAccessSessions = () => Promise<void>;
type SynchronizeEdgeAppAccessState = () => Promise<void>;
type ResolveDnsRecord = (hostname: string) => Promise<string[]>;
type ResolveTxtRecord = (hostname: string) => Promise<string[][]>;
type FetchSystemDomainProbeHttp = typeof OutboundHttpService.fetchSystemDomainProbeHttp;

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

interface OutboundHttpServiceMocks {
  fetchSystemDomainProbeHttp: Mock<FetchSystemDomainProbeHttp>;
}

interface SeedScopedOidcHiddenAdminInput {
  hiddenOrganizationId: string;
  principalId: string;
  providerId: string;
  sessionId: string;
  sessionToken: string;
  visibleOrganizationId: string;
}

interface SeedSsoAdminPathInput {
  assignmentId: string;
  email: string;
  identityId: string;
  membershipId: string;
  organizationId: string;
  principalId: string;
  providerId: string;
}

function buildBrowserOrganizationProjectDeploymentsPathname(organizationSlug: string, projectName: string): string {
  return `${buildBrowserOrganizationProjectsPathname(organizationSlug)}/${encodeURIComponent(projectName)}/deployments`;
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

const outboundHttpServiceMocks: OutboundHttpServiceMocks = vi.hoisted(
  (): OutboundHttpServiceMocks => ({
    fetchSystemDomainProbeHttp: vi.fn<FetchSystemDomainProbeHttp>(),
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

vi.mock(
  '../src/services/outbound-http.service',
  async (importOriginal: () => Promise<typeof OutboundHttpService>): Promise<typeof OutboundHttpService> => {
    const actualModule: typeof OutboundHttpService = await importOriginal();
    return {
      ...actualModule,
      fetchSystemDomainProbeHttp: outboundHttpServiceMocks.fetchSystemDomainProbeHttp,
    };
  },
);

function buildSystemMutationHeaders(idempotencyKey: string): Record<string, string> {
  return {
    ...buildSystemAuthorizationHeaders(),
    'idempotency-key': idempotencyKey,
  };
}

function buildCustomExternalDomainSetRequest(
  expectedSetupVersion: number,
  baseDomain: string = 'customer.example.com',
): SystemDomainSetRequest {
  return {
    expectedSetupVersion,
    hostPlan: {
      baseDomain,
      domainKind: 'custom',
      issuerRef: { kind: 'Issuer', name: 'customer-issuer' },
      publicScheme: 'https',
      tlsMode: 'external',
    },
  };
}

function createCustomHttpApiConfig(): ApiConfig {
  return {
    ...defaultApiConfig,
    baseDomain: 'customer.example.com',
    tlsMode: 'issuer',
    controlPlaneHost: 'console.customer.example.com',
    publicProtocol: 'https',
    auditRetentionDays: 90,
    auditRetentionCleanupBatchSize: 1000,
    auditRetentionCleanupCron: '0 3 * * *',
    auditRetentionCleanupMaxBatches: 100,
    auditFileSink: defaultAuditFileSinkConfig,
    rollbackRetentionLimit: null,
  };
}

const {
  apiConfig: defaultApiConfig,
  databaseUrl: apiIntegrationDatabaseUrl,
  testCustomTlsDirectory,
} = createApiIntegrationTestContext('api_integration_install_auth', 'api-integration-install-auth');
let pool!: Pool;
let db!: Database;
let app!: ApiApp;
let systemApp!: ApiApp;
let hasInitializedApiIntegrationRuntime: boolean = false;

describe('Phase 0 API integration install auth', (): void => {
  useApiDatabaseTestHarness(apiIntegrationDatabaseUrl);

  beforeEach(async (): Promise<void> => {
    appAccessEdgeServiceMocks.invalidateEdgeAppAccessSessions.mockReset();
    appAccessEdgeServiceMocks.invalidateEdgeAppAccessSessions.mockResolvedValue(undefined);
    appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState.mockReset();
    appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState.mockResolvedValue(undefined);
    dnsPromiseMocks.resolve4.mockReset();
    dnsPromiseMocks.resolve4.mockResolvedValue([publicIpv4Address]);
    dnsPromiseMocks.resolve6.mockReset();
    dnsPromiseMocks.resolve6.mockRejectedValue(new Error('No AAAA record.'));
    dnsPromiseMocks.resolveCname.mockReset();
    dnsPromiseMocks.resolveCname.mockRejectedValue(new Error('No CNAME record.'));
    dnsPromiseMocks.resolveTxt.mockReset();
    dnsPromiseMocks.resolveTxt.mockRejectedValue(new Error('No TXT record.'));
    outboundHttpServiceMocks.fetchSystemDomainProbeHttp.mockReset();
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
  it('rejects an unauthenticated attempt to claim the first owner', async (): Promise<void> => {
    const payload: Record<string, string> = {
      adminPassword: 'supersecretpassword',
      organizationName: 'Attacker',
      organizationSlug: 'attacker',
      adminEmail: 'attacker@example.com',
      baseDomain: 'localhost',
    };
    const responses: LightMyRequestResponse[] = await Promise.all([
      app.inject({ method: 'POST', url: '/v1/install', payload }),
      app.inject({
        headers: buildInstallAuthorizationHeaders('wrong-install-token'),
        method: 'POST',
        url: '/v1/install',
        payload,
      }),
    ]);

    expect(responses.map((response: LightMyRequestResponse): number => response.statusCode)).toEqual([401, 401]);
    expect(
      responses.map(
        (response: LightMyRequestResponse): string => errorResponseSchema.parse(response.json()).error.code,
      ),
    ).toEqual(['install_unauthorized', 'install_unauthorized']);
    await expect(db.select({ value: count() }).from(organizations)).resolves.toEqual([{ value: 0 }]);
  });
  it('keeps DNS verification pending on direct ingress mismatch', async (): Promise<void> => {
    await installCompartment(app);
    configureApiRuntimeWithPublicIngress(defaultApiConfig, db, createManagedPublicIngressConfig());

    const setResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/set',
      headers: buildSystemMutationHeaders('domain-dns-binding-fail-set'),
      payload: buildCustomExternalDomainSetRequest(0),
    });
    expect(setResponse.statusCode).toBe(200);
    const setPayload: SystemDomainMutationResponse = systemDomainMutationResponseSchema.parse(setResponse.json());
    dnsPromiseMocks.resolveTxt.mockResolvedValue([
      [requireSystemDomainDnsRecord(setPayload, 'ownership', 'TXT').value],
    ]);
    dnsPromiseMocks.resolve4.mockResolvedValue([mismatchedPublicIpv4Address]);

    const verifyResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/verify',
      headers: buildSystemMutationHeaders('domain-dns-binding-fail-verify'),
      payload: { expectedSetupVersion: 1 },
    });
    expect(verifyResponse.statusCode).toBe(200);
    const verifyPayload: SystemDomainMutationResponse = systemDomainMutationResponseSchema.parse(verifyResponse.json());
    expect(verifyPayload.status.pending?.status).toBe('pending_dns');
    expect(verifyPayload.status.pending?.failureCode).toBe('dns_binding_invalid');
  });

  it('keeps DNS verification pending on unsafe direct ingress answers', async (): Promise<void> => {
    await installCompartment(app);
    configureApiRuntimeWithPublicIngress(defaultApiConfig, db, createManagedPublicIngressConfig());

    const setResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/set',
      headers: buildSystemMutationHeaders('domain-dns-unsafe-set'),
      payload: buildCustomExternalDomainSetRequest(0),
    });
    expect(setResponse.statusCode).toBe(200);
    const setPayload: SystemDomainMutationResponse = systemDomainMutationResponseSchema.parse(setResponse.json());
    dnsPromiseMocks.resolveTxt.mockResolvedValue([
      [requireSystemDomainDnsRecord(setPayload, 'ownership', 'TXT').value],
    ]);
    dnsPromiseMocks.resolve4.mockResolvedValue(['127.0.0.1']);

    const verifyResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/verify',
      headers: buildSystemMutationHeaders('domain-dns-unsafe-verify'),
      payload: { expectedSetupVersion: 1 },
    });
    expect(verifyResponse.statusCode).toBe(200);
    const verifyPayload: SystemDomainMutationResponse = systemDomainMutationResponseSchema.parse(verifyResponse.json());
    expect(verifyPayload.status.pending?.status).toBe('pending_dns');
    expect(verifyPayload.status.pending?.failureCode).toBe('dns_binding_unsafe');
  });

  it('keeps DNS verification pending when public ingress config disappears after staging', async (): Promise<void> => {
    await installCompartment(app);
    configureApiRuntimeWithPublicIngress(defaultApiConfig, db, createManagedPublicIngressConfig());

    const setResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/set',
      headers: buildSystemMutationHeaders('domain-dns-ingress-missing-set'),
      payload: buildCustomExternalDomainSetRequest(0),
    });
    expect(setResponse.statusCode).toBe(200);
    const setPayload: SystemDomainMutationResponse = systemDomainMutationResponseSchema.parse(setResponse.json());
    dnsPromiseMocks.resolveTxt.mockResolvedValue([
      [requireSystemDomainDnsRecord(setPayload, 'ownership', 'TXT').value],
    ]);

    configureApiRuntimeWithPublicIngress(defaultApiConfig, db, createEmptyPublicIngressConfig());
    const verifyResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/verify',
      headers: buildSystemMutationHeaders('domain-dns-ingress-missing-verify'),
      payload: { expectedSetupVersion: 1 },
    });
    expect(verifyResponse.statusCode).toBe(200);
    const verifyPayload: SystemDomainMutationResponse = systemDomainMutationResponseSchema.parse(verifyResponse.json());
    expect(verifyPayload.status.pending?.status).toBe('pending_dns');
    expect(verifyPayload.status.pending?.failureCode).toBe('dns_binding_invalid');
    expect(verifyPayload.status.pending?.failureMessage).toBe(
      'System domain verification requires COMPARTMENT_PUBLIC_INGRESS_IPV4 or COMPARTMENT_PUBLIC_INGRESS_IPV6.',
    );
  });

  it('blocks activation when direct ingress binding changed after verify', async (): Promise<void> => {
    await installCompartment(app);
    configureApiRuntimeWithPublicIngress(defaultApiConfig, db, createManagedPublicIngressConfig());

    const setResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/set',
      headers: buildSystemMutationHeaders('domain-activate-recheck-set'),
      payload: buildCustomExternalDomainSetRequest(0),
    });
    expect(setResponse.statusCode).toBe(200);
    const setPayload: SystemDomainMutationResponse = systemDomainMutationResponseSchema.parse(setResponse.json());
    dnsPromiseMocks.resolveTxt.mockResolvedValue([
      [requireSystemDomainDnsRecord(setPayload, 'ownership', 'TXT').value],
    ]);

    const verifyResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/verify',
      headers: buildSystemMutationHeaders('domain-activate-recheck-verify'),
      payload: { expectedSetupVersion: 1 },
    });
    expect(verifyResponse.statusCode).toBe(200);

    configureApiRuntime({ config: createCustomHttpApiConfig(), db });
    dnsPromiseMocks.resolve4.mockResolvedValue([mismatchedPublicIpv4Address]);
    const activateResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/activate',
      headers: buildSystemMutationHeaders('domain-activate-recheck-activate'),
      payload: { expectedSetupVersion: 2 },
    });
    expect(activateResponse.statusCode).toBe(409);
    expect(errorResponseSchema.parse(activateResponse.json()).error.code).toBe('domain_operation_unavailable');
  });

  it('refreshes active domain health and serves the public active domain probe', async (): Promise<void> => {
    await installCompartment(app);
    outboundHttpServiceMocks.fetchSystemDomainProbeHttp.mockResolvedValue(new Response('{}', { status: 200 }));

    const probeResponse: LightMyRequestResponse = await app.inject({
      headers: {
        host: 'console.localhost',
      },
      method: 'GET',
      url: '/_compartment/domain/probe/active',
    });
    expect(probeResponse.statusCode).toBe(200);

    const refreshResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/status/refresh',
      headers: buildSystemAuthorizationHeaders(),
    });
    expect(refreshResponse.statusCode).toBe(200);
    const refreshPayload: SystemDomainStatusResponse = systemDomainStatusResponseSchema.parse(refreshResponse.json());
    expect(refreshPayload.activeDomainHealth.status).toBe('ok');
    expect(refreshPayload.activeDomainHealth.checkedAt).not.toBeNull();
    expect(outboundHttpServiceMocks.fetchSystemDomainProbeHttp).toHaveBeenCalledWith(
      'http://console.localhost/_compartment/domain/probe/active',
      expect.any(Object),
    );
  });

  it('serializes concurrent duplicate domain mutations by idempotency key', async (): Promise<void> => {
    await installCompartment(app);
    configureApiRuntimeWithPublicIngress(defaultApiConfig, db, createManagedPublicIngressConfig());

    const setRequest: SystemDomainSetRequest = buildCustomExternalDomainSetRequest(0);
    const responses: LightMyRequestResponse[] = await Promise.all([
      systemApp.inject({
        method: 'POST',
        url: '/internal/system/domain/set',
        headers: buildSystemMutationHeaders('domain-set-concurrent'),
        payload: setRequest,
      }),
      systemApp.inject({
        method: 'POST',
        url: '/internal/system/domain/set',
        headers: buildSystemMutationHeaders('domain-set-concurrent'),
        payload: setRequest,
      }),
    ]);

    expect(responses.map((response: LightMyRequestResponse): number => response.statusCode)).toEqual([200, 200]);
    const payloads: SystemDomainMutationResponse[] = responses.map(
      (response: LightMyRequestResponse): SystemDomainMutationResponse =>
        systemDomainMutationResponseSchema.parse(response.json()),
    );
    expect(payloads[1]).toEqual(payloads[0]);
  });
  it('rejects invalid base domains during install with a client error', async (): Promise<void> => {
    const installResponse: LightMyRequestResponse = await app.inject({
      headers: buildInstallAuthorizationHeaders(),
      method: 'POST',
      url: '/v1/install',
      payload: {
        adminPassword: 'supersecretpassword',
        organizationName: 'Acme Dev',
        organizationSlug: 'acme-dev',
        adminEmail: 'admin@example.com',
        baseDomain: 'my env',
      },
    });

    expect(installResponse.statusCode).toBe(400);
    expect(errorResponseSchema.parse(installResponse.json()).error.code).toBe('invalid_base_domain');
  });
  it('rejects install requests whose organization name cannot produce a slug', async (): Promise<void> => {
    const installResponse: LightMyRequestResponse = await app.inject({
      headers: buildInstallAuthorizationHeaders(),
      method: 'POST',
      url: '/v1/install',
      payload: {
        adminPassword: 'supersecretpassword',
        organizationName: '!!!',
        adminEmail: 'admin@example.com',
        baseDomain: 'localhost',
      },
    });

    expect(installResponse.statusCode).toBe(400);
    expect(errorResponseSchema.parse(installResponse.json()).error.code).toBe('invalid_organization_slug');
  });
  it('rejects install requests with an invalid explicit organization slug at the request boundary', async (): Promise<void> => {
    const installResponse: LightMyRequestResponse = await app.inject({
      headers: buildInstallAuthorizationHeaders(),
      method: 'POST',
      url: '/v1/install',
      payload: {
        adminPassword: 'supersecretpassword',
        organizationName: 'Acme Dev',
        organizationSlug: 'Hello World',
        adminEmail: 'admin@example.com',
        baseDomain: 'localhost',
      },
    });

    expect(installResponse.statusCode).toBe(400);
    expect(errorResponseSchema.parse(installResponse.json()).error.code).toBe('invalid_install_request');
  });
  it('allows only one concurrent install request to initialize the compartment', async (): Promise<void> => {
    const [firstInstallResponse, secondInstallResponse]: [LightMyRequestResponse, LightMyRequestResponse] =
      await Promise.all([
        app.inject({
          headers: buildInstallAuthorizationHeaders(),
          method: 'POST',
          url: '/v1/install',
          payload: {
            adminPassword: 'supersecretpassword',
            organizationName: 'Acme Dev',
            organizationSlug: 'acme-dev',
            adminEmail: 'admin@example.com',
            baseDomain: 'localhost',
          },
        }),
        app.inject({
          headers: buildInstallAuthorizationHeaders(),
          method: 'POST',
          url: '/v1/install',
          payload: {
            adminPassword: 'supersecretpassword',
            organizationName: 'Beta Dev',
            organizationSlug: 'beta-dev',
            adminEmail: 'beta@example.com',
            baseDomain: 'localhost',
          },
        }),
      ]);
    const statusCodes: number[] = [firstInstallResponse.statusCode, secondInstallResponse.statusCode].sort(
      (left: number, right: number): number => left - right,
    );
    const storedOrganizationsCount: { value: number }[] = await db.select({ value: count() }).from(organizations);
    const storedOperations: StoredOperationRow[] = await db.select().from(operations);

    expect(statusCodes).toEqual([200, 409]);
    expect(storedOrganizationsCount[0]?.value).toBe(1);
    expect(storedOperations).toHaveLength(1);
    expect(storedOperations[0]?.type).toBe('compartment.install');
  });
  it('establishes a session and returns current organization from whoami', async (): Promise<void> => {
    const installResponse: LightMyRequestResponse = await app.inject({
      headers: buildInstallAuthorizationHeaders(),
      method: 'POST',
      url: '/v1/install',
      payload: {
        adminPassword: 'supersecretpassword',
        organizationName: 'Acme Dev',
        organizationSlug: 'acme-dev',
        adminEmail: 'admin@example.com',
        baseDomain: 'localhost',
      },
    });
    const installPayload: InstallResponse = installResponseSchema.parse(installResponse.json());
    expectNoStoreCacheControlHeader(installResponse);
    const whoAmIResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/whoami',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(whoAmIResponse.statusCode).toBe(200);
    expectNoStoreCacheControlHeader(whoAmIResponse);
    const whoAmIPayload: WhoAmIResponse = whoamiResponseSchema.parse(whoAmIResponse.json());
    expect(whoAmIPayload.currentOrganization?.slug).toBe('acme-dev');
    expect(whoAmIPayload.currentOrganizationPermissions).toEqual(
      expect.arrayContaining([
        'organization.user.invite',
        'organization.user.block',
        'organization.user.remove',
        'organization.user.credentials.reset',
      ]),
    );
  });
  it('returns deployment-scope permissions from whoami when a project environment is requested', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const deployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
    );

    expect(deployResponse.statusCode).toBe(200);
    expectNoStoreCacheControlHeader(deployResponse);

    const whoAmIResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/whoami?projectName=smoke-web&environmentName=production',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });

    expect(whoAmIResponse.statusCode).toBe(200);
    const whoAmIPayload: WhoAmIResponse = whoamiResponseSchema.parse(whoAmIResponse.json());
    expect(whoAmIPayload.currentOrganization?.slug).toBe('acme-dev');
    expect(whoAmIPayload.currentOrganizationPermissions).toContain('deployment.read');
    expect(whoAmIPayload.currentOrganizationPermissions).toContain('deployment.rollback');
  });
  it('rejects organization creation when admin access only exists in a hidden session organization', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const hiddenOrganizationResponse: LightMyRequestResponse = await app.inject({
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
      },
      method: 'POST',
      payload: {
        name: 'Hidden Dev',
        slug: 'hidden-dev',
      },
      url: '/v1/organizations',
    });
    expect(hiddenOrganizationResponse.statusCode).toBe(200);
    const hiddenOrganizationPayload: CreateOrganizationResponse = createOrganizationResponseSchema.parse(
      hiddenOrganizationResponse.json(),
    );
    await createStoredSsoOidcProvider('sop_visible_create_scope', installPayload.organization.id);
    await seedScopedOidcHiddenAdmin({
      hiddenOrganizationId: hiddenOrganizationPayload.organization.id,
      principalId: 'prn_hidden_admin',
      providerId: 'sop_visible_create_scope',
      sessionId: 'ses_hidden_admin',
      sessionToken: 'hidden-admin-session-token',
      visibleOrganizationId: installPayload.organization.id,
    });

    const createOrganizationResponse: LightMyRequestResponse = await app.inject({
      headers: {
        authorization: 'Bearer hidden-admin-session-token',
      },
      method: 'POST',
      payload: {
        name: 'Blocked Dev',
        slug: 'blocked-dev',
      },
      url: '/v1/organizations',
    });

    expect(createOrganizationResponse.statusCode).toBe(403);
    expect(errorResponseSchema.parse(createOrganizationResponse.json()).error.code).toBe('forbidden');
  });
  it('revokes the authenticated session on logout and blocks further protected access', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const logoutResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
      },
    });

    expect(logoutResponse.statusCode).toBe(200);
    expectNoStoreCacheControlHeader(logoutResponse);
    expect(logoutResponse.json()).toEqual({ success: true });

    const whoAmIResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/whoami',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(whoAmIResponse.statusCode).toBe(401);
    expectNoStoreCacheControlHeader(whoAmIResponse);
    expect(errorResponseSchema.parse(whoAmIResponse.json()).error.code).toBe('unauthorized');

    const deployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
    );
    expect(deployResponse.statusCode).toBe(401);
    expectNoStoreCacheControlHeader(deployResponse);
    expect(errorResponseSchema.parse(deployResponse.json()).error.code).toBe('unauthorized');

    const storedOperations: StoredOperationRow[] = await db.select().from(operations);
    expect(storedOperations).toHaveLength(2);
    expect(
      storedOperations.some(
        (storedOperation: StoredOperationRow): boolean =>
          storedOperation.type === 'auth.logout' && storedOperation.status === 'succeeded',
      ),
    ).toBe(true);
  });
  it('keeps browser session cookies host-bound and ignores legacy tossed session cookies', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const browserLogoutLandingPathname: string = `${browserLoginPathname}?autoRedirect=false`;
    const browserLoginStatePathname: string = `${authApiLoginStatePathname}?autoRedirect=false`;
    const legacySessionCookieName: string = 'compartment_session';

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
    expect(String(browserLoginResponse.headers['set-cookie'])).toContain(
      `${compartmentSessionCookieName}=${browserSessionToken}; Path=/`,
    );
    expect(String(browserLoginResponse.headers['set-cookie'])).toContain('Secure');
    expect(String(browserLoginResponse.headers['set-cookie'])).toContain('HttpOnly');
    expect(String(browserLoginResponse.headers['set-cookie'])).toContain('SameSite=Lax');
    expect(String(browserLoginResponse.headers['set-cookie'])).not.toContain('Domain=');
    const attackerSessionToken: string = await createOrganizationMemberSessionFixture({
      db,
      email: 'cookie-toss-attacker@example.com',
      organizationId: installPayload.organization.id,
      role: 'viewer',
      sessionSecret: defaultApiConfig.sessionSecret,
      sessionToken: 'cookie-toss-attacker-session-token',
    });

    const browserLogoutRedirectResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: browserLogoutPathname,
      headers: {
        cookie: `${compartmentSessionCookieName}=${browserSessionToken}`,
      },
    });
    expect(browserLogoutRedirectResponse.statusCode).toBe(302);
    expect(browserLogoutRedirectResponse.headers.location).toBe(browserLogoutLandingPathname);
    expect(browserLogoutRedirectResponse.headers['set-cookie']).toBeUndefined();

    const browserLoginPageResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: browserLogoutLandingPathname,
      headers: {
        cookie: `${compartmentSessionCookieName}=${browserSessionToken}`,
      },
    });
    expect(browserLoginPageResponse.statusCode).toBe(200);
    const browserLogoutCsrfToken: string = requireSetCookieValue(
      browserLoginPageResponse.headers['set-cookie'],
      compartmentCsrfCookieName,
    );
    expect(String(browserLoginPageResponse.headers['set-cookie'])).toContain(
      `${compartmentCsrfCookieName}=${browserLogoutCsrfToken}; Path=/`,
    );
    expect(String(browserLoginPageResponse.headers['set-cookie'])).toContain('Secure');
    expect(String(browserLoginPageResponse.headers['set-cookie'])).not.toContain('Domain=');

    const browserLoginStateResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: browserLoginStatePathname,
      headers: {
        cookie: `${compartmentSessionCookieName}=${browserSessionToken}`,
      },
    });
    expect(browserLoginStateResponse.statusCode).toBe(200);
    const browserLoginStatePayload: { principalEmail?: string; view?: string } = browserLoginStateResponse.json();
    expect(browserLoginStatePayload.principalEmail).toBe('admin@example.com');
    expect(browserLoginStatePayload.view).not.toBe('redirect');

    const browserWhoAmIResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/whoami',
      headers: {
        cookie: `${compartmentSessionCookieName}=${browserSessionToken}`,
      },
    });
    expect(browserWhoAmIResponse.statusCode).toBe(200);
    expect(whoamiResponseSchema.parse(browserWhoAmIResponse.json()).principal.email).toBe('admin@example.com');

    const browserWhoAmIWithLegacyOnlyCookieResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/whoami',
      headers: {
        cookie: `${legacySessionCookieName}=${browserSessionToken}`,
      },
    });
    expect(browserWhoAmIWithLegacyOnlyCookieResponse.statusCode).toBe(401);
    expect(errorResponseSchema.parse(browserWhoAmIWithLegacyOnlyCookieResponse.json()).error.code).toBe('unauthorized');

    const browserWhoAmIWithLegacyTossedCookieResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/whoami',
      headers: {
        cookie: `${legacySessionCookieName}=${attackerSessionToken}; ${compartmentSessionCookieName}=${browserSessionToken}`,
      },
    });
    expect(browserWhoAmIWithLegacyTossedCookieResponse.statusCode).toBe(200);
    expect(whoamiResponseSchema.parse(browserWhoAmIWithLegacyTossedCookieResponse.json()).principal.email).toBe(
      'admin@example.com',
    );

    const browserCookieHeader: string = `${compartmentSessionCookieName}=${browserSessionToken}; ${compartmentCsrfCookieName}=${browserLogoutCsrfToken}`;
    const browserOrigin: string = readDefaultBrowserOrigin();
    const browserLogoutResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: authApiLogoutPathname,
      headers: {
        [compartmentCsrfHeaderName]: browserLogoutCsrfToken,
        cookie: browserCookieHeader,
        host: defaultApiConfig.controlPlaneHost,
        origin: browserOrigin,
      },
    });
    expect(browserLogoutResponse.statusCode).toBe(200);
    expect(browserLogoutResponse.json()).toEqual({ success: true });
    expect(String(browserLogoutResponse.headers['set-cookie'])).toContain(`${compartmentSessionCookieName}=`);

    const browserWhoAmIAfterLogoutResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/whoami',
      headers: {
        cookie: `${compartmentSessionCookieName}=${browserSessionToken}`,
      },
    });
    expect(browserWhoAmIAfterLogoutResponse.statusCode).toBe(401);
    expect(errorResponseSchema.parse(browserWhoAmIAfterLogoutResponse.json()).error.code).toBe('unauthorized');
  });
  it('revokes stale browser password sessions after disabling local password login', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await createStoredSsoOidcProvider('sop_password_disable', installPayload.organization.id);
    await seedSsoAdminPath({
      assignmentId: 'asg_password_disable_sso_admin',
      email: 'password-disable-sso-admin@example.com',
      identityId: 'soi_password_disable_sso_admin',
      membershipId: 'mem_password_disable_sso_admin',
      organizationId: installPayload.organization.id,
      principalId: 'prn_password_disable_sso_admin',
      providerId: 'sop_password_disable',
    });
    const browserSession: StoredBrowserSession = await createBrowserCookieSession(app, 'acme-dev');
    await createStoredAppAccessSession('aps_password_browser', browserSession.sessionId);

    const staleBrowserProjectsResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: buildBrowserOrganizationProjectsPathname('acme-dev'),
      headers: {
        cookie: `${compartmentSessionCookieName}=${browserSession.sessionToken}`,
      },
    });
    expect(staleBrowserProjectsResponse.statusCode).toBe(200);

    const staleBrowserDeploymentsResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: buildBrowserOrganizationProjectDeploymentsPathname('acme-dev', 'smoke-web'),
      headers: {
        cookie: `${compartmentSessionCookieName}=${browserSession.sessionToken}`,
      },
    });
    expect(staleBrowserDeploymentsResponse.statusCode).toBe(200);

    const staleBrowserDeploymentDetailsResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: buildBrowserOrganizationProjectDeploymentDetailsPathname('acme-dev', 'smoke-web', 'dep_123'),
      headers: {
        cookie: `${compartmentSessionCookieName}=${browserSession.sessionToken}`,
      },
    });
    expect(staleBrowserDeploymentDetailsResponse.statusCode).toBe(200);

    const disablePasswordResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'PATCH',
      payload: {
        localPasswordEnabled: false,
      },
      url: '/v1/auth/settings',
    });
    expect(disablePasswordResponse.statusCode).toBe(200);

    expect((await readStoredAuthSession(browserSession.sessionId)).revokedAt).not.toBeNull();
    expect((await readStoredAppAccessSession('aps_password_browser')).revokedAt).not.toBeNull();
    expect(appAccessEdgeServiceMocks.invalidateEdgeAppAccessSessions).toHaveBeenCalledWith(browserSession.sessionId);

    const browserProjectsAfterDisableResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: buildBrowserOrganizationProjectsPathname('acme-dev'),
      headers: {
        cookie: `${compartmentSessionCookieName}=${browserSession.sessionToken}`,
      },
    });
    expect(browserProjectsAfterDisableResponse.statusCode).toBe(302);
    expect(browserProjectsAfterDisableResponse.headers.location).toBe(browserLoginPathname);

    const browserDeploymentsAfterDisableResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: buildBrowserOrganizationProjectDeploymentsPathname('acme-dev', 'smoke-web'),
      headers: {
        cookie: `${compartmentSessionCookieName}=${browserSession.sessionToken}`,
      },
    });
    expect(browserDeploymentsAfterDisableResponse.statusCode).toBe(302);
    expect(browserDeploymentsAfterDisableResponse.headers.location).toBe(browserLoginPathname);

    const browserDeploymentDetailsAfterDisableResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: buildBrowserOrganizationProjectDeploymentDetailsPathname('acme-dev', 'smoke-web', 'dep_123'),
      headers: {
        cookie: `${compartmentSessionCookieName}=${browserSession.sessionToken}`,
      },
    });
    expect(browserDeploymentDetailsAfterDisableResponse.statusCode).toBe(302);
    expect(browserDeploymentDetailsAfterDisableResponse.headers.location).toBe(browserLoginPathname);

    const browserApiAfterDisableResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/projects?detail=overview',
      headers: {
        cookie: `${compartmentSessionCookieName}=${browserSession.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(browserApiAfterDisableResponse.statusCode).toBe(401);
    expect(errorResponseSchema.parse(browserApiAfterDisableResponse.json()).error.code).toBe('unauthorized');
  });

  it('revokes browser password sessions resolved through the single local password organization', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await createStoredSsoOidcProvider('sop_password_disable_global', installPayload.organization.id);
    await seedSsoAdminPath({
      assignmentId: 'asg_password_disable_global_sso_admin',
      email: 'password-disable-global-sso-admin@example.com',
      identityId: 'soi_password_disable_global_sso_admin',
      membershipId: 'mem_password_disable_global_sso_admin',
      organizationId: installPayload.organization.id,
      principalId: 'prn_password_disable_global_sso_admin',
      providerId: 'sop_password_disable_global',
    });
    const browserSession: StoredBrowserSession = await createBrowserCookieSession(app);
    await createStoredAppAccessSession('aps_password_browser_global', browserSession.sessionId);

    const staleBrowserProjectsResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: buildBrowserOrganizationProjectsPathname('acme-dev'),
      headers: {
        cookie: `${compartmentSessionCookieName}=${browserSession.sessionToken}`,
      },
    });
    expect(staleBrowserProjectsResponse.statusCode).toBe(200);

    const disablePasswordResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'PATCH',
      payload: {
        localPasswordEnabled: false,
      },
      url: '/v1/auth/settings',
    });
    expect(disablePasswordResponse.statusCode).toBe(200);

    expect((await readStoredAuthSession(browserSession.sessionId)).revokedAt).not.toBeNull();
    expect((await readStoredAppAccessSession('aps_password_browser_global')).revokedAt).not.toBeNull();
    expect(appAccessEdgeServiceMocks.invalidateEdgeAppAccessSessions).toHaveBeenCalledWith(browserSession.sessionId);

    const browserProjectsAfterDisableResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: buildBrowserOrganizationProjectsPathname('acme-dev'),
      headers: {
        cookie: `${compartmentSessionCookieName}=${browserSession.sessionToken}`,
      },
    });
    expect(browserProjectsAfterDisableResponse.statusCode).toBe(302);
    expect(browserProjectsAfterDisableResponse.headers.location).toBe(browserLoginPathname);
  });
});

async function seedScopedOidcHiddenAdmin(input: SeedScopedOidcHiddenAdminInput): Promise<void> {
  await db.insert(principals).values({
    email: 'hidden-admin@example.com',
    id: input.principalId,
    type: 'user',
  });
  await db.insert(organizationMemberships).values([
    {
      id: 'mem_hidden_admin_visible',
      organizationId: input.visibleOrganizationId,
      principalId: input.principalId,
    },
    {
      id: 'mem_hidden_admin_hidden',
      organizationId: input.hiddenOrganizationId,
      principalId: input.principalId,
    },
  ]);
  await db.insert(accessAssignments).values({
    id: 'asg_hidden_admin_hidden',
    organizationId: input.hiddenOrganizationId,
    roleId: await readAccessRoleId(input.hiddenOrganizationId, 'admin'),
    scopeId: input.hiddenOrganizationId,
    scopeType: 'organization',
    subjectId: input.principalId,
    subjectType: 'principal',
  });
  await db.insert(authSessions).values({
    authMethodKind: 'oidc',
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    id: input.sessionId,
    oidcProviderId: input.providerId,
    organizationId: input.visibleOrganizationId,
    principalId: input.principalId,
    tokenHash: hashToken(input.sessionToken, defaultApiConfig.sessionSecret),
  });
}

async function seedSsoAdminPath(input: SeedSsoAdminPathInput): Promise<void> {
  await db.insert(principals).values({
    email: input.email,
    id: input.principalId,
    type: 'user',
  });
  await db.insert(organizationMemberships).values({
    id: input.membershipId,
    organizationId: input.organizationId,
    principalId: input.principalId,
  });
  await db.insert(accessAssignments).values({
    id: input.assignmentId,
    organizationId: input.organizationId,
    roleId: await readAccessRoleId(input.organizationId, 'admin'),
    scopeId: input.organizationId,
    scopeType: 'organization',
    subjectId: input.principalId,
    subjectType: 'principal',
  });
  await db.insert(ssoOidcIdentities).values({
    id: input.identityId,
    principalId: input.principalId,
    providerId: input.providerId,
    subject: `${input.principalId}-subject`,
  });
}

async function readAccessRoleId(organizationId: string, roleName: string): Promise<string> {
  const rows: { id: string }[] = await db
    .select({ id: accessRoles.id })
    .from(accessRoles)
    .where(and(eq(accessRoles.organizationId, organizationId), eq(accessRoles.name, roleName)))
    .limit(1);
  const roleId: string | undefined = rows[0]?.id;
  if (roleId === undefined) {
    throw new Error(`Expected ${roleName} role for organization ${organizationId}.`);
  }

  return roleId;
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

function requireSystemDomainDnsRecord(
  response: SystemDomainMutationResponse,
  purpose: DomainDnsRecordPurpose,
  recordType?: DomainDnsRecordType,
): DomainDnsRecord {
  const record: DomainDnsRecord | undefined = response.status.pending?.requiredDnsRecords.find(
    (candidate: DomainDnsRecord): boolean =>
      candidate.purpose === purpose && (recordType === undefined || candidate.recordType === recordType),
  );
  if (record === undefined) {
    throw new Error(`Expected system domain ${purpose} DNS record.`);
  }

  return record;
}

async function createBrowserCookieSession(apiApp: ApiApp, organizationSlug?: string): Promise<StoredBrowserSession> {
  const browserCsrfToken: string = requireSetCookieValue(createBrowserCsrfCookie(), compartmentCsrfCookieName);
  return await createBrowserCookieSessionFixture({
    apiApp,
    browserCsrfHeaders: buildBrowserCsrfHeaders(browserCsrfToken),
    db,
    organizationSlug,
    sessionSecret: defaultApiConfig.sessionSecret,
  });
}

async function createStoredSsoOidcProvider(providerId: string, organizationId: string): Promise<void> {
  await createStoredSsoOidcProviderFixture({
    db,
    organizationId,
    providerId,
    variablesMasterKey: defaultApiConfig.variablesMasterKey,
  });
}

async function createStoredAppAccessSession(appSessionId: string, authSessionId: string): Promise<void> {
  await createStoredAppAccessSessionFixture(db, defaultApiConfig.sessionSecret, appSessionId, authSessionId);
}

async function readStoredAuthSession(sessionId: string): Promise<{ revokedAt: Date | null }> {
  return await readStoredAuthSessionFixture(db, sessionId);
}

async function readStoredAppAccessSession(appSessionId: string): Promise<{ revokedAt: Date | null }> {
  return await readStoredAppAccessSessionFixture(db, appSessionId);
}
