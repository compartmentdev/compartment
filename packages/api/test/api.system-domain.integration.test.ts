import {
  errorResponseSchema,
  installResponseSchema,
  systemDomainMutationResponseSchema,
  systemDomainStatusResponseSchema,
  type DomainDnsRecord,
  type DomainDnsRecordPurpose,
  type DomainDnsRecordType,
  type InstallResponse,
  type SystemDomainMutationResponse,
  type SystemDomainSetRequest,
  type SystemDomainStatusResponse,
} from '@compartment/contracts';
import type { LightMyRequestResponse } from 'fastify';
import type { Pool } from 'pg';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  deriveProcessScopedDatabaseUrl,
  ensureDatabaseExists,
  readDatabaseTestMode,
  resetDatabase,
  runCompartmentApiMigrations as runApiMigrations,
} from '../../test-support/src';
import { createApp, createSystemApp } from '../src/app';
import type { ApiApp } from '../src/app.types';
import { readApiConfig, type ApiConfig, type ApiPublicIngressConfig } from '../src/config';
import type * as OutboundHttpService from '../src/services/outbound-http.service';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import { operations, systemDomainSetupState } from '../src/db/schema';
import { createEdgeStateUpdateFailedError } from '../src/errors/api-business-error';
import { clearApiRuntime, configureApiRuntime } from '../src/runtime/runtime';

import { buildInstallAuthorizationHeaders, installCompartment } from './api-integration.harness';
import {
  alternatePublicIpv4Address,
  createEmptyPublicIngressConfig,
  createManagedPublicIngressConfig,
  publicIpv4Address,
} from './api-app-test.harness';
import type { StoredOperationRow } from './api.integration.types';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';

type InvalidateEdgeAppAccessSessions = () => Promise<void>;
type SynchronizeEdgeAppAccessState = () => Promise<void>;
type ResolveDnsRecord = (hostname: string) => Promise<string[]>;
type ResolveTxtRecord = (hostname: string) => Promise<string[][]>;
type FetchSystemDomainProbeHttp = typeof OutboundHttpService.fetchSystemDomainProbeHttp;
type SystemDomainSetupStateRecord = typeof systemDomainSetupState.$inferSelect;

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

function buildSystemAuthorizationHeaders(token: string = 'test-system-token'): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
  };
}

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
    usageMeteringIntervalMs: 60_000,
    usageRetentionDays: 400,
    auditFileSink: defaultAuditFileSinkConfig,
    rollbackRetentionLimit: null,
  };
}

function createManagedApiConfig(): ApiConfig {
  return {
    ...defaultApiConfig,
    baseDomain: '4h8z9k2m1p7q.app.compartment.run',
    tlsMode: 'broker-dns01',
    controlPlaneHost: 'console.4h8z9k2m1p7q.app.compartment.run',
    publicProtocol: 'https',
    auditRetentionDays: 90,
    auditRetentionCleanupBatchSize: 1000,
    auditRetentionCleanupCron: '0 3 * * *',
    auditRetentionCleanupMaxBatches: 100,
    usageMeteringIntervalMs: 60_000,
    usageRetentionDays: 400,
    auditFileSink: defaultAuditFileSinkConfig,
    rollbackRetentionLimit: null,
  };
}

const { testDatabaseUrl } = readDatabaseTestMode();
const apiIntegrationDatabaseUrl: string = deriveProcessScopedDatabaseUrl(
  testDatabaseUrl,
  'api_integration_system_domain',
);
process.env.COMPARTMENT_DATABASE_URL = apiIntegrationDatabaseUrl;
process.env.COMPARTMENT_SESSION_SECRET = process.env.COMPARTMENT_SESSION_SECRET ?? 'test-secret';
process.env.COMPARTMENT_ENV = 'dev';
process.env.COMPARTMENT_INSTALL_TOKEN = 'test-install-token';
process.env.COMPARTMENT_BASE_DOMAIN = 'localhost';
process.env.COMPARTMENT_TLS_MODE = 'internal';
process.env.COMPARTMENT_PUBLIC_PROTOCOL = 'http';
process.env.COMPARTMENT_PUBLIC_HTTP_PORT = '80';
process.env.COMPARTMENT_PUBLIC_HTTPS_PORT = '443';
process.env.COMPARTMENT_INGRESS_TARGETS_JSON = '[]';
process.env.COMPARTMENT_POSTGRES_PASSWORD = 'postgres';
process.env.COMPARTMENT_EDGE_TOKEN = 'test-edge-token';
process.env.COMPARTMENT_SYSTEM_API_SOCKET = '/tmp/compartment/api-integration-system-domain/system-api.sock';
process.env.COMPARTMENT_SYSTEM_TOKEN = 'test-system-token';
process.env.COMPARTMENT_THROTTLE_AUTH_LOGIN_ROUTE_MAX_REQUESTS = '30';
process.env.COMPARTMENT_THROTTLE_AUTH_LOGIN_ROUTE_WINDOW = '1m';
process.env.COMPARTMENT_THROTTLE_AUTH_LOGIN_SOURCE_MAX_FAILURES = '20';
process.env.COMPARTMENT_THROTTLE_AUTH_LOGIN_SOURCE_WINDOW = '5m';
process.env.COMPARTMENT_THROTTLE_AUTH_LOGIN_SOURCE_BLOCK = '15m';
process.env.COMPARTMENT_THROTTLE_AUTH_LOGIN_ACCOUNT_MAX_FAILURES = '10';
process.env.COMPARTMENT_THROTTLE_AUTH_LOGIN_ACCOUNT_WINDOW = '10m';
process.env.COMPARTMENT_THROTTLE_AUTH_LOGIN_ACCOUNT_BLOCK = '30m';
process.env.COMPARTMENT_THROTTLE_AUTH_LOGIN_SOURCE_ACCOUNT_MAX_FAILURES = '5';
process.env.COMPARTMENT_THROTTLE_AUTH_LOGIN_SOURCE_ACCOUNT_WINDOW = '1m';
process.env.COMPARTMENT_THROTTLE_AUTH_LOGIN_SOURCE_ACCOUNT_BLOCK = '10m';
process.env.COMPARTMENT_THROTTLE_AUTH_ACTIVATE_ROUTE_MAX_REQUESTS = '10';
process.env.COMPARTMENT_THROTTLE_AUTH_ACTIVATE_ROUTE_WINDOW = '1m';
process.env.COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SOURCE_MAX_FAILURES = '15';
process.env.COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SOURCE_WINDOW = '10m';
process.env.COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SOURCE_BLOCK = '30m';
process.env.COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SUBJECT_MAX_FAILURES = '5';
process.env.COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SUBJECT_WINDOW = '30m';
process.env.COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SUBJECT_BLOCK = '60m';
process.env.COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SOURCE_SUBJECT_MAX_FAILURES = '3';
process.env.COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SOURCE_SUBJECT_WINDOW = '10m';
process.env.COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SOURCE_SUBJECT_BLOCK = '30m';
process.env.COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_ROUTE_MAX_REQUESTS = '10';
process.env.COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_ROUTE_WINDOW = '1m';
process.env.COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_MAX_FAILURES = '15';
process.env.COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_WINDOW = '10m';
process.env.COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_BLOCK = '30m';
process.env.COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SUBJECT_MAX_FAILURES = '5';
process.env.COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SUBJECT_WINDOW = '30m';
process.env.COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SUBJECT_BLOCK = '60m';
process.env.COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_SUBJECT_MAX_FAILURES = '3';
process.env.COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_SUBJECT_WINDOW = '10m';
process.env.COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_SUBJECT_BLOCK = '30m';
process.env.COMPARTMENT_VARIABLES_MASTER_KEY = process.env.COMPARTMENT_VARIABLES_MASTER_KEY ?? '11'.repeat(32);
process.env.COMPARTMENT_RUNTIME_CONTROL_TOKEN = 'test-runtime-control-token';
const defaultApiConfig: ApiConfig = readApiConfig();
let pool!: Pool;
let db!: Database;
let app!: ApiApp;
let systemApp!: ApiApp;
let hasInitializedApiIntegrationRuntime: boolean = false;

describe('Phase 0 API integration system domain', (): void => {
  beforeAll(async (): Promise<void> => {
    await ensureDatabaseExists(apiIntegrationDatabaseUrl);
  });
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
    await resetDatabase(apiIntegrationDatabaseUrl);
    await runApiMigrations(apiIntegrationDatabaseUrl);
    pool = createDatabasePool(apiIntegrationDatabaseUrl);
    db = createDatabase(pool);
    try {
      app = createApp({ closePool: false, config: defaultApiConfig, configureRuntime: false, db, pool });
      systemApp = createSystemApp({
        closePool: false,
        config: defaultApiConfig,
        configureRuntime: false,
        db,
        pool,
      });
    } catch (error) {
      await pool.end();
      throw error;
    }
    configureApiRuntimeWithPublicIngress(defaultApiConfig);
    hasInitializedApiIntegrationRuntime = true;
  });
  afterEach(async (): Promise<void> => {
    vi.unstubAllGlobals();
    if (!hasInitializedApiIntegrationRuntime) {
      return;
    }

    hasInitializedApiIntegrationRuntime = false;
    clearApiRuntime();
    await Promise.allSettled([app.close(), systemApp.close()]);
    await pool.end();
  });
  it('creates the first organization, admin credentials, and operation record during install', async (): Promise<void> => {
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
    expect(installResponse.statusCode).toBe(200);
    const payload: InstallResponse = installResponseSchema.parse(installResponse.json());
    expect(payload.organization.slug).toBe('acme-dev');
    expect(payload.sessionToken).toBeTruthy();
    const storedOperations: StoredOperationRow[] = await db.select().from(operations);
    expect(storedOperations).toHaveLength(1);
    expect(storedOperations[0]?.type).toBe('compartment.install');
  });
  it('serves domain status only through the protected system listener', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const publicResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/internal/system/domain/status',
      headers: buildSystemAuthorizationHeaders(),
    });
    expect(publicResponse.statusCode).toBe(404);

    const missingTokenResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'GET',
      url: '/internal/system/domain/status',
    });
    expect(missingTokenResponse.statusCode).toBe(401);
    expect(errorResponseSchema.parse(missingTokenResponse.json()).error.code).toBe('system_api_unauthorized');

    const userTokenResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'GET',
      url: '/internal/system/domain/status',
      headers: buildSystemAuthorizationHeaders(installPayload.sessionToken),
    });
    expect(userTokenResponse.statusCode).toBe(401);
    expect(errorResponseSchema.parse(userTokenResponse.json()).error.code).toBe('system_api_unauthorized');

    const statusResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'GET',
      url: '/internal/system/domain/status',
      headers: buildSystemAuthorizationHeaders(),
    });
    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.headers['x-ratelimit-limit']).toBe('600');
    const payload: SystemDomainStatusResponse = systemDomainStatusResponseSchema.parse(statusResponse.json());
    expect(payload.active).toEqual({
      baseDomain: 'localhost',
      domainKind: 'local',
      publicScheme: 'http',
      tlsMode: 'internal',
    });
    expect(payload.setupVersion).toBe(0);
    expect(payload.pending).toBeNull();
  });
  it('requires system auth and idempotency keys on mutating domain routes', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const routeSpecs: { payload: object; url: string }[] = [
      {
        payload: buildCustomExternalDomainSetRequest(0),
        url: '/internal/system/domain/set',
      },
      {
        payload: { expectedSetupVersion: 0 },
        url: '/internal/system/domain/verify',
      },
      {
        payload: { expectedSetupVersion: 0 },
        url: '/internal/system/domain/activate',
      },
      {
        payload: { expectedSetupVersion: 0 },
        url: '/internal/system/domain/reset-managed',
      },
    ];

    for (const routeSpec of routeSpecs) {
      const missingTokenResponse: LightMyRequestResponse = await systemApp.inject({
        method: 'POST',
        url: routeSpec.url,
        headers: { 'idempotency-key': 'domain-mutation-auth' },
        payload: routeSpec.payload,
      });
      expect(missingTokenResponse.statusCode).toBe(401);
      expect(errorResponseSchema.parse(missingTokenResponse.json()).error.code).toBe('system_api_unauthorized');

      const userTokenResponse: LightMyRequestResponse = await systemApp.inject({
        method: 'POST',
        url: routeSpec.url,
        headers: {
          ...buildSystemAuthorizationHeaders(installPayload.sessionToken),
          'idempotency-key': 'domain-mutation-user-token',
        },
        payload: routeSpec.payload,
      });
      expect(userTokenResponse.statusCode).toBe(401);
      expect(errorResponseSchema.parse(userTokenResponse.json()).error.code).toBe('system_api_unauthorized');

      const missingIdempotencyResponse: LightMyRequestResponse = await systemApp.inject({
        method: 'POST',
        url: routeSpec.url,
        headers: buildSystemAuthorizationHeaders(),
        payload: routeSpec.payload,
      });
      expect(missingIdempotencyResponse.statusCode).toBe(400);
      expect(errorResponseSchema.parse(missingIdempotencyResponse.json()).error.code).toBe('missing_idempotency_key');

      const blankIdempotencyResponse: LightMyRequestResponse = await systemApp.inject({
        method: 'POST',
        url: routeSpec.url,
        headers: {
          ...buildSystemAuthorizationHeaders(),
          'idempotency-key': '   ',
        },
        payload: routeSpec.payload,
      });
      expect(blankIdempotencyResponse.statusCode).toBe(400);
      expect(errorResponseSchema.parse(blankIdempotencyResponse.json()).error.code).toBe('missing_idempotency_key');
    }
  });
  it('stages and replaces pending domain state with idempotency and CAS', async (): Promise<void> => {
    await installCompartment(app);
    configureApiRuntimeWithPublicIngress(defaultApiConfig, createManagedPublicIngressConfig());

    const setRequest: SystemDomainSetRequest = buildCustomExternalDomainSetRequest(0);
    const setResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/set',
      headers: buildSystemMutationHeaders('domain-set-1'),
      payload: setRequest,
    });
    expect(setResponse.statusCode).toBe(200);
    const setPayload: SystemDomainMutationResponse = systemDomainMutationResponseSchema.parse(setResponse.json());
    expect(setPayload.setupVersion).toBe(1);
    expect(setPayload.status.pending?.status).toBe('pending_dns');
    expect(setPayload.status.pending?.hostPlan).toEqual(setRequest.hostPlan);
    expect(requireSystemDomainDnsRecord(setPayload, 'ownership', 'TXT').value).toMatch(
      /^compartment-domain-verification=domop_/u,
    );

    const duplicateSetResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/set',
      headers: buildSystemMutationHeaders('domain-set-1'),
      payload: setRequest,
    });
    expect(duplicateSetResponse.statusCode).toBe(200);
    expect(systemDomainMutationResponseSchema.parse(duplicateSetResponse.json())).toEqual(setPayload);

    const idempotencyConflictResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/set',
      headers: buildSystemMutationHeaders('domain-set-1'),
      payload: buildCustomExternalDomainSetRequest(1, 'apps2.example.com'),
    });
    expect(idempotencyConflictResponse.statusCode).toBe(409);
    expect(errorResponseSchema.parse(idempotencyConflictResponse.json()).error.code).toBe(
      'domain_idempotency_conflict',
    );

    const staleReplaceResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/set',
      headers: buildSystemMutationHeaders('domain-set-stale-replace'),
      payload: buildCustomExternalDomainSetRequest(0, 'apps2.example.com'),
    });
    expect(staleReplaceResponse.statusCode).toBe(409);
    expect(errorResponseSchema.parse(staleReplaceResponse.json()).error.code).toBe('domain_version_conflict');

    const replaceRequest: SystemDomainSetRequest = buildCustomExternalDomainSetRequest(1, 'apps2.example.com');
    const replaceResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/set',
      headers: buildSystemMutationHeaders('domain-set-replace'),
      payload: replaceRequest,
    });
    expect(replaceResponse.statusCode).toBe(200);
    const replacePayload: SystemDomainMutationResponse = systemDomainMutationResponseSchema.parse(
      replaceResponse.json(),
    );
    expect(replacePayload.setupVersion).toBe(2);
    expect(replacePayload.status.pending?.status).toBe('pending_dns');
    expect(replacePayload.status.pending?.hostPlan).toEqual(replaceRequest.hostPlan);
  });

  it('refreshes pending DNS instructions from the current ingress config on status reads', async (): Promise<void> => {
    await installCompartment(app);
    configureApiRuntimeWithPublicIngress(defaultApiConfig, createManagedPublicIngressConfig());

    const setResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/set',
      headers: buildSystemMutationHeaders('domain-status-refresh-set'),
      payload: buildCustomExternalDomainSetRequest(0),
    });
    expect(setResponse.statusCode).toBe(200);

    configureApiRuntimeWithPublicIngress(defaultApiConfig, {
      targets: [{ type: 'A', value: alternatePublicIpv4Address }],
    });
    const statusResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'GET',
      url: '/internal/system/domain/status',
      headers: buildSystemAuthorizationHeaders(),
    });
    expect(statusResponse.statusCode).toBe(200);
    const statusPayload: SystemDomainStatusResponse = systemDomainStatusResponseSchema.parse(statusResponse.json());
    const routingRecord: DomainDnsRecord | undefined = statusPayload.pending?.requiredDnsRecords.find(
      (record: DomainDnsRecord): boolean => record.purpose === 'routing' && record.recordType === 'A',
    );

    expect(routingRecord?.value).toBe(alternatePublicIpv4Address);
  });

  it('verifies DNS, activates issuer-managed domain state, and syncs edge', async (): Promise<void> => {
    await installCompartment(app);
    configureApiRuntimeWithPublicIngress(defaultApiConfig, createManagedPublicIngressConfig());
    appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState.mockClear();

    const setResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/set',
      headers: buildSystemMutationHeaders('domain-issuer-set'),
      payload: buildCustomExternalDomainSetRequest(0),
    });
    expect(setResponse.statusCode).toBe(200);
    const setPayload: SystemDomainMutationResponse = systemDomainMutationResponseSchema.parse(setResponse.json());
    const ownershipRecord: DomainDnsRecord = requireSystemDomainDnsRecord(setPayload, 'ownership', 'TXT');
    dnsPromiseMocks.resolveTxt.mockResolvedValue([[ownershipRecord.value]]);

    const verifyResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/verify',
      headers: buildSystemMutationHeaders('domain-issuer-verify'),
      payload: { expectedSetupVersion: 1 },
    });
    expect(verifyResponse.statusCode).toBe(200);
    const verifyPayload: SystemDomainMutationResponse = systemDomainMutationResponseSchema.parse(verifyResponse.json());
    expect(verifyPayload.status.pending?.status).toBe('verified');
    expect(verifyPayload.setupVersion).toBe(2);

    configureApiRuntime({ config: createCustomHttpApiConfig(), db });
    const activateResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/activate',
      headers: buildSystemMutationHeaders('domain-issuer-activate'),
      payload: { expectedSetupVersion: 2 },
    });
    expect(activateResponse.statusCode).toBe(200);
    const activatePayload: SystemDomainMutationResponse = systemDomainMutationResponseSchema.parse(
      activateResponse.json(),
    );
    expect(activatePayload.status.pending).toBeNull();
    expect(activatePayload.status.active).toEqual({
      baseDomain: 'customer.example.com',
      domainKind: 'custom',
      publicScheme: 'https',
      tlsMode: 'external',
    });
    expect(appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState).toHaveBeenCalledTimes(1);

    const [storedSetupState]: SystemDomainSetupStateRecord[] = await db.select().from(systemDomainSetupState);
    expect(storedSetupState?.pendingStatus).toBeNull();

    outboundHttpServiceMocks.fetchSystemDomainProbeHttp.mockResolvedValue(new Response('{}', { status: 200 }));
    const refreshResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/status/refresh',
      headers: buildSystemAuthorizationHeaders(),
    });
    expect(refreshResponse.statusCode).toBe(200);
    expect(outboundHttpServiceMocks.fetchSystemDomainProbeHttp).toHaveBeenCalledWith(
      'https://console.customer.example.com/_compartment/domain/probe/active',
      expect.any(Object),
    );
  });

  it('keeps activation durable when edge sync fails and marks domain health unhealthy', async (): Promise<void> => {
    await installCompartment(app);
    configureApiRuntimeWithPublicIngress(defaultApiConfig, createManagedPublicIngressConfig());
    appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState.mockClear();

    const setResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/set',
      headers: buildSystemMutationHeaders('domain-edge-fail-set'),
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
      headers: buildSystemMutationHeaders('domain-edge-fail-verify'),
      payload: { expectedSetupVersion: 1 },
    });
    expect(verifyResponse.statusCode).toBe(200);

    configureApiRuntime({ config: createCustomHttpApiConfig(), db });
    appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState.mockRejectedValueOnce(createEdgeStateUpdateFailedError());
    const activateResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/activate',
      headers: buildSystemMutationHeaders('domain-edge-fail-activate'),
      payload: { expectedSetupVersion: 2 },
    });
    expect(activateResponse.statusCode).toBe(200);
    const activatePayload: SystemDomainMutationResponse = systemDomainMutationResponseSchema.parse(
      activateResponse.json(),
    );
    expect(activatePayload.status.pending).toBeNull();
    expect(activatePayload.status.active.baseDomain).toBe('customer.example.com');
    expect(activatePayload.status.activeDomainHealth.status).toBe('unhealthy');
    expect(activatePayload.status.activeDomainHealth.failureCode).toBe('edge_sync_failed');
  });

  it('resets a custom domain operation back to the active managed runtime and syncs edge', async (): Promise<void> => {
    await installCompartment(app);
    configureApiRuntimeWithPublicIngress(defaultApiConfig, createManagedPublicIngressConfig());

    const setResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/set',
      headers: buildSystemMutationHeaders('domain-reset-managed-set'),
      payload: buildCustomExternalDomainSetRequest(0),
    });
    expect(setResponse.statusCode).toBe(200);

    configureApiRuntime({ config: createManagedApiConfig(), db });
    appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState.mockClear();
    const resetResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/reset-managed',
      headers: buildSystemMutationHeaders('domain-reset-managed'),
      payload: { expectedSetupVersion: 1 },
    });
    expect(resetResponse.statusCode).toBe(200);
    const resetPayload: SystemDomainMutationResponse = systemDomainMutationResponseSchema.parse(resetResponse.json());
    expect(resetPayload.setupVersion).toBe(2);
    expect(resetPayload.status.pending).toBeNull();
    expect(resetPayload.status.active).toEqual({
      baseDomain: '4h8z9k2m1p7q.app.compartment.run',
      domainKind: 'managed',
      publicScheme: 'https',
      tlsMode: 'broker-dns01',
    });
    expect(appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState).toHaveBeenCalledTimes(1);

    const duplicateResetResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/reset-managed',
      headers: buildSystemMutationHeaders('domain-reset-managed'),
      payload: { expectedSetupVersion: 1 },
    });
    expect(duplicateResetResponse.statusCode).toBe(200);
    expect(systemDomainMutationResponseSchema.parse(duplicateResetResponse.json())).toEqual(resetPayload);
  });
});

function configureApiRuntimeWithPublicIngress(
  config: ApiConfig,
  publicIngressConfig: ApiPublicIngressConfig = createEmptyPublicIngressConfig(),
): void {
  process.env.COMPARTMENT_INGRESS_TARGETS_JSON = JSON.stringify(publicIngressConfig.targets);
  configureApiRuntime({ config, db });
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
