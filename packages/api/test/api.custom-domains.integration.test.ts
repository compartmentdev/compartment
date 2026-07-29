import {
  deployResponseSchema,
  errorResponseSchema,
  createCustomDomainResponseSchema,
  customDomainResponseSchema,
  listCustomDomainsResponseSchema,
  removeCustomDomainResponseSchema,
  verifyCustomDomainResponseSchema,
  systemDomainMutationResponseSchema,
  type CreateCustomDomainResponse,
  type CustomDomainDnsRecord,
  type CustomDomainDnsRecordPurpose,
  type DomainDnsRecord,
  type DomainDnsRecordPurpose,
  type DomainDnsRecordType,
  type CustomDomainResponse,
  type CustomDomainSummary,
  type DeploymentSummary,
  type DeployResponse,
  type InstallResponse,
  type ManagedDomainTarget,
  type SystemDomainMutationResponse,
  type SystemDomainSetRequest,
  type RemoveCustomDomainResponse,
  type VerifyCustomDomainResponse,
  type WorkerClaimedDeployment,
} from '@compartment/contracts';
import type { LightMyRequestResponse } from 'fastify';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  deriveProcessScopedDatabaseUrl,
  ensureDatabaseExists,
  readDatabaseTestMode,
  resetDatabase,
  runCompartmentApiMigrations as runApiMigrations,
} from '../../test-support/src';
import { createApp, createSystemApp } from '../src/app';
import type { ApiApp } from '../src/app.types';
import { createOrganizationMemberSession as createOrganizationMemberSessionFixture } from './api-auth-session-test.fixtures';
import { readApiConfig, type ApiConfig, type ApiPublicIngressConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';

import { deploymentCustomDomains, deployments } from '../src/db/schema';
import { createEdgeStateUpdateFailedError } from '../src/errors/api-business-error';
import { clearApiRuntime, configureApiRuntime } from '../src/runtime/runtime';

import {
  buildOrganizationAuthorizationHeaders,
  claimNextQueuedDeployment,
  completeClaimedDeployment,
  injectDeployRequest,
  installCompartment,
  requireClaimedDeployment,
  requireDeployResponseDeployment,
} from './api-integration.harness';
import {
  createEmptyPublicIngressConfig,
  createManagedPublicIngressConfig,
  publicIpv4Address,
  publicIpv6Address,
} from './api-app-test.harness';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';

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

interface StoredCustomDomainVerificationRow {
  failureMessage: string | null;
  lastCheckedAt: Date | null;
  ownershipStatus: string;
  routingStatus: string;
  verifiedAt: Date | null;
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

function createOperatorApiConfig(): ApiConfig {
  return {
    ...defaultApiConfig,
    baseDomain: 'customer.example.com',
    tlsMode: 'issuer',
    controlPlaneHost: 'console.customer.example.com',
    publicProtocol: 'https',
  };
}

function createManagedDualStackPublicIngressConfig(): ApiPublicIngressConfig {
  return {
    targets: [
      { type: 'A', value: publicIpv4Address },
      { type: 'AAAA', value: publicIpv6Address },
    ],
  };
}

function readIngressTarget(config: ApiPublicIngressConfig, type: 'A' | 'AAAA'): string {
  const target: string | undefined = config.targets.find(
    (candidate: ManagedDomainTarget): boolean => candidate.type === type,
  )?.value;
  if (target === undefined) {
    throw new Error(`Missing ${type} ingress target.`);
  }
  return target;
}

const { testDatabaseUrl } = readDatabaseTestMode();
const apiIntegrationDatabaseUrl: string = deriveProcessScopedDatabaseUrl(
  testDatabaseUrl,
  'api_integration_custom_domains',
);
process.env.COMPARTMENT_DATABASE_URL = apiIntegrationDatabaseUrl;
const testTempDirectory: string = resolve(tmpdir(), 'compartment-api-integration-custom-domains-temp');
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
process.env.COMPARTMENT_SYSTEM_API_SOCKET = '/tmp/compartment/api-integration-custom-domains/system-api.sock';
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

describe('Phase 0 API integration custom domains', (): void => {
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
    await rm(testTempDirectory, { force: true, recursive: true });
    await mkdir(testTempDirectory, { recursive: true });
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
  afterAll(async (): Promise<void> => {
    await rm(testTempDirectory, { force: true, recursive: true });
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
  it('rejects managed reset before the runtime has switched back to managed mode', async (): Promise<void> => {
    await installCompartment(app);

    const resetResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/reset-managed',
      headers: buildSystemMutationHeaders('domain-reset-managed-unavailable'),
      payload: { expectedSetupVersion: 0 },
    });

    expect(resetResponse.statusCode).toBe(409);
    expect(errorResponseSchema.parse(resetResponse.json()).error.code).toBe('domain_operation_unavailable');
  });

  it('keeps managed reset durable when edge sync fails and marks domain health unhealthy', async (): Promise<void> => {
    await installCompartment(app);
    configureApiRuntimeWithPublicIngress(defaultApiConfig, createManagedPublicIngressConfig());

    const setResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/set',
      headers: buildSystemMutationHeaders('domain-reset-managed-edge-fail-set'),
      payload: buildCustomExternalDomainSetRequest(0),
    });
    expect(setResponse.statusCode).toBe(200);

    configureApiRuntime({ config: createManagedApiConfig(), db });
    appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState.mockRejectedValueOnce(createEdgeStateUpdateFailedError());
    const resetResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/reset-managed',
      headers: buildSystemMutationHeaders('domain-reset-managed-edge-fail'),
      payload: { expectedSetupVersion: 1 },
    });
    expect(resetResponse.statusCode).toBe(200);
    const resetPayload: SystemDomainMutationResponse = systemDomainMutationResponseSchema.parse(resetResponse.json());
    expect(resetPayload.status.pending).toBeNull();
    expect(resetPayload.status.active.domainKind).toBe('managed');
    expect(resetPayload.status.activeDomainHealth.status).toBe('unhealthy');
    expect(resetPayload.status.activeDomainHealth.failureCode).toBe('edge_sync_failed');
  });

  it('persists, verifies, lists, and removes custom app domains through the protected API', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const canonicalLocalRouteHost: string = await deployAndCompleteSmokeWeb(installPayload.sessionToken);
    const managedApiConfig: ApiConfig = createManagedApiConfig();
    const publicIngressConfig: ApiPublicIngressConfig = createManagedPublicIngressConfig();
    configureApiRuntimeWithPublicIngress(managedApiConfig, publicIngressConfig);
    appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState.mockClear();

    try {
      const createPayload: CreateCustomDomainResponse = await createCustomDomain(installPayload.sessionToken);
      const ownershipRecord: CustomDomainDnsRecord = requireCustomDomainDnsRecord(createPayload, 'ownership');
      const routingRecord: CustomDomainDnsRecord = requireCustomDomainDnsRecord(createPayload, 'routing');
      expect(createPayload.domain).toMatchObject({
        canonicalRouteHost: `smoke-web.${managedApiConfig.baseDomain}`,
        host: 'app.customer.example.com',
        status: 'pending',
      });
      expect(ownershipRecord.recordType).toBe('TXT');
      expect(routingRecord).toMatchObject({
        recordType: 'A',
        value: readIngressTarget(publicIngressConfig, 'A'),
      });
      expect(canonicalLocalRouteHost).toBe('smoke-web.localhost');

      const duplicateResponse: LightMyRequestResponse = await createDuplicateCustomDomain(installPayload.sessionToken);
      expect(duplicateResponse.statusCode).toBe(409);
      expect(errorResponseSchema.parse(duplicateResponse.json()).error.code).toBe('custom_domain_collision');

      dnsPromiseMocks.resolveTxt.mockResolvedValue([[ownershipRecord.value]]);
      dnsPromiseMocks.resolve4.mockResolvedValue([readIngressTarget(publicIngressConfig, 'A')]);
      const verifyPayload: VerifyCustomDomainResponse = await verifyCustomDomain(installPayload.sessionToken);
      expect(verifyPayload.domain.status).toBe('reconciling');
      expect(appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState).not.toHaveBeenCalled();

      expect(await listCustomDomains(installPayload.sessionToken)).toHaveLength(1);
      expect((await showCustomDomain(installPayload.sessionToken)).domain.status).toBe('reconciling');
      expect(await removeCustomDomain(installPayload.sessionToken)).toEqual({
        host: 'app.customer.example.com',
        removed: true,
      });
      expect(await db.select().from(deploymentCustomDomains)).toEqual([
        expect.objectContaining({ deletionReady: true, reconcileState: 'deleting' }),
      ]);
      expect(appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState).toHaveBeenCalledOnce();
    } finally {
      configureApiRuntime({ config: defaultApiConfig, db });
    }
  });

  it('hides a custom-domain host that is already assigned to another organization', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await deployAndCompleteSmokeWeb(installPayload.sessionToken);
    await createOrganization(installPayload.sessionToken, 'Beta Dev', 'beta-dev');
    await deployAndCompleteSmokeWeb(installPayload.sessionToken, 'beta-dev');
    configureApiRuntimeWithPublicIngress(createManagedApiConfig(), createManagedPublicIngressConfig());

    try {
      await createCustomDomain(installPayload.sessionToken);

      const crossOrganizationResponse: LightMyRequestResponse = await createDuplicateCustomDomain(
        installPayload.sessionToken,
        defaultCustomDomainHost,
        'beta-dev',
      );

      expect(crossOrganizationResponse.statusCode).toBe(409);
      expect(errorResponseSchema.parse(crossOrganizationResponse.json()).error.code).toBe('custom_domain_collision');
      expect(await db.select().from(deploymentCustomDomains)).toHaveLength(1);
    } finally {
      configureApiRuntime({ config: defaultApiConfig, db });
    }
  });

  it('persists and verifies managed dual-stack custom app domains through the protected API', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await deployAndCompleteSmokeWeb(installPayload.sessionToken);
    const managedApiConfig: ApiConfig = createManagedApiConfig();
    const publicIngressConfig: ApiPublicIngressConfig = createManagedDualStackPublicIngressConfig();
    configureApiRuntimeWithPublicIngress(managedApiConfig, publicIngressConfig);

    try {
      const host: string = 'dual.customer.example.com';
      const createPayload: CreateCustomDomainResponse = await createCustomDomain(installPayload.sessionToken, host);
      const ownershipRecord: CustomDomainDnsRecord = requireCustomDomainDnsRecord(createPayload, 'ownership');
      const routingRecords: CustomDomainDnsRecord[] = requireCustomDomainDnsRecords(createPayload, 'routing');

      expect(routingRecords).toEqual([
        expect.objectContaining({
          recordType: 'A',
          value: readIngressTarget(publicIngressConfig, 'A'),
        }),
        expect.objectContaining({
          recordType: 'AAAA',
          value: readIngressTarget(publicIngressConfig, 'AAAA'),
        }),
      ]);

      dnsPromiseMocks.resolveTxt.mockResolvedValue([[ownershipRecord.value]]);
      dnsPromiseMocks.resolve4.mockResolvedValue([readIngressTarget(publicIngressConfig, 'A')]);
      dnsPromiseMocks.resolve6.mockResolvedValue([readIngressTarget(publicIngressConfig, 'AAAA')]);

      const verifyPayload: VerifyCustomDomainResponse = await verifyCustomDomain(installPayload.sessionToken, host);
      expect(verifyPayload.domain.status).toBe('reconciling');
      await expect(removeCustomDomain(installPayload.sessionToken, host)).resolves.toEqual({
        host,
        removed: true,
      });
    } finally {
      configureApiRuntime({ config: defaultApiConfig, db });
    }
  });

  it('persists and verifies issuer-backed subdomain custom app domains through the protected API', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await deployAndCompleteSmokeWeb(installPayload.sessionToken);
    const operatorApiConfig: ApiConfig = createOperatorApiConfig();
    configureApiRuntime({ config: operatorApiConfig, db });

    try {
      const host: string = 'app.public.example.com';
      const createPayload: CreateCustomDomainResponse = await createCustomDomain(installPayload.sessionToken, host);
      const ownershipRecord: CustomDomainDnsRecord = requireCustomDomainDnsRecord(createPayload, 'ownership');
      const routingRecord: CustomDomainDnsRecord = requireCustomDomainDnsRecord(createPayload, 'routing');

      expect(createPayload.domain).toMatchObject({
        canonicalRouteHost: `smoke-web.${operatorApiConfig.baseDomain}`,
        host,
        status: 'pending',
      });
      expect(routingRecord).toMatchObject({
        recordType: 'CNAME',
        value: `smoke-web.${operatorApiConfig.baseDomain}`,
      });

      dnsPromiseMocks.resolveTxt.mockResolvedValue([[ownershipRecord.value]]);
      dnsPromiseMocks.resolveCname.mockResolvedValue([`smoke-web.${operatorApiConfig.baseDomain}.`]);

      const verifyPayload: VerifyCustomDomainResponse = await verifyCustomDomain(installPayload.sessionToken, host);
      expect(verifyPayload.domain.status).toBe('reconciling');
      await expect(removeCustomDomain(installPayload.sessionToken, host)).resolves.toEqual({
        host,
        removed: true,
      });
    } finally {
      configureApiRuntime({ config: defaultApiConfig, db });
    }
  });

  it('persists and verifies issuer-backed apex custom app domains through the protected API', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await deployAndCompleteSmokeWeb(installPayload.sessionToken);
    const operatorApiConfig: ApiConfig = createOperatorApiConfig();
    configureApiRuntime({ config: operatorApiConfig, db });

    try {
      const host: string = 'example.co.uk';
      const createPayload: CreateCustomDomainResponse = await createCustomDomain(installPayload.sessionToken, host);
      const ownershipRecord: CustomDomainDnsRecord = requireCustomDomainDnsRecord(createPayload, 'ownership');
      const routingRecord: CustomDomainDnsRecord = requireCustomDomainDnsRecord(createPayload, 'routing');

      expect(routingRecord).toMatchObject({
        recordType: 'APEX_ALIAS',
        required: false,
        value: `smoke-web.${operatorApiConfig.baseDomain}`,
      });

      dnsPromiseMocks.resolveTxt.mockResolvedValue([[ownershipRecord.value]]);
      dnsPromiseMocks.resolveCname.mockResolvedValue([]);
      dnsPromiseMocks.resolve4.mockResolvedValueOnce([publicIpv4Address]).mockResolvedValueOnce([publicIpv4Address]);
      dnsPromiseMocks.resolve6.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      const verifyPayload: VerifyCustomDomainResponse = await verifyCustomDomain(installPayload.sessionToken, host);
      expect(verifyPayload.domain.status).toBe('reconciling');
      await expect(removeCustomDomain(installPayload.sessionToken, host)).resolves.toEqual({
        host,
        removed: true,
      });
    } finally {
      configureApiRuntime({ config: defaultApiConfig, db });
    }
  });

  it('keeps custom domain reads and lists available without an active deployment', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await deployAndCompleteSmokeWeb(installPayload.sessionToken);
    const managedApiConfig: ApiConfig = createManagedApiConfig();
    const publicIngressConfig: ApiPublicIngressConfig = createManagedPublicIngressConfig();
    configureApiRuntimeWithPublicIngress(managedApiConfig, publicIngressConfig);

    try {
      const host: string = 'durable.customer.example.com';
      const createPayload: CreateCustomDomainResponse = await createCustomDomain(installPayload.sessionToken, host);
      const ownershipRecord: CustomDomainDnsRecord = requireCustomDomainDnsRecord(createPayload, 'ownership');
      dnsPromiseMocks.resolveTxt.mockResolvedValue([[ownershipRecord.value]]);
      dnsPromiseMocks.resolve4.mockResolvedValue([readIngressTarget(publicIngressConfig, 'A')]);

      const readyPayload: VerifyCustomDomainResponse = await verifyCustomDomain(installPayload.sessionToken, host);
      expect(readyPayload.domain.status).toBe('reconciling');

      await db.update(deployments).set({ isActive: false }).where(eq(deployments.isActive, true));

      const listedDomains: CustomDomainSummary[] = await listCustomDomains(installPayload.sessionToken);
      const shownDomain: CustomDomainResponse = await showCustomDomain(installPayload.sessionToken, host);

      expect(listedDomains).toEqual([
        expect.objectContaining({
          canonicalRouteHost: `smoke-web.${managedApiConfig.baseDomain}`,
          host,
          status: 'reconciling',
        }),
      ]);
      expect(shownDomain.domain).toMatchObject({
        canonicalRouteHost: `smoke-web.${managedApiConfig.baseDomain}`,
        host,
        status: 'reconciling',
      });
    } finally {
      configureApiRuntime({ config: defaultApiConfig, db });
    }
  });

  it('allows readonly members to list and show custom domains but blocks custom-domain mutations', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await deployAndCompleteSmokeWeb(installPayload.sessionToken);
    const managedApiConfig: ApiConfig = createManagedApiConfig();
    const publicIngressConfig: ApiPublicIngressConfig = createManagedPublicIngressConfig();
    configureApiRuntimeWithPublicIngress(managedApiConfig, publicIngressConfig);

    try {
      const host: string = 'readonly.customer.example.com';
      const createPayload: CreateCustomDomainResponse = await createCustomDomain(installPayload.sessionToken, host);
      const ownershipRecord: CustomDomainDnsRecord = requireCustomDomainDnsRecord(createPayload, 'ownership');
      dnsPromiseMocks.resolveTxt.mockResolvedValue([[ownershipRecord.value]]);
      dnsPromiseMocks.resolve4.mockResolvedValue([readIngressTarget(publicIngressConfig, 'A')]);
      await verifyCustomDomain(installPayload.sessionToken, host);

      const readonlySessionToken: string = await createOrganizationMemberSession(installPayload, 'readonly');
      const readonlyHeaders: Record<string, string> = buildOrganizationAuthorizationHeaders(readonlySessionToken);

      const listResponse: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: '/v1/domains?projectName=smoke-web&serviceName=web',
        headers: readonlyHeaders,
      });
      expect(listResponse.statusCode).toBe(200);
      expect(listCustomDomainsResponseSchema.parse(listResponse.json()).domains).toEqual([
        expect.objectContaining({
          host,
          status: 'reconciling',
        }),
      ]);

      const showResponse: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: `/v1/domains/${encodeURIComponent(host)}`,
        headers: readonlyHeaders,
      });
      expect(showResponse.statusCode).toBe(200);
      expect(customDomainResponseSchema.parse(showResponse.json()).domain).toMatchObject({
        host,
        status: 'reconciling',
      });

      const addResponse: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: '/v1/domains',
        headers: readonlyHeaders,
        payload: {
          host: 'blocked-readonly.customer.example.com',
          projectName: 'smoke-web',
          serviceName: 'web',
        },
      });
      expect(addResponse.statusCode).toBe(403);
      expect(errorResponseSchema.parse(addResponse.json()).error.code).toBe('forbidden');

      const verifyResponse: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: `/v1/domains/${encodeURIComponent(host)}/verify`,
        headers: readonlyHeaders,
      });
      expect(verifyResponse.statusCode).toBe(404);
      expect(errorResponseSchema.parse(verifyResponse.json()).error.code).toBe('custom_domain_not_found');

      const removeResponse: LightMyRequestResponse = await app.inject({
        method: 'DELETE',
        url: `/v1/domains/${encodeURIComponent(host)}`,
        headers: readonlyHeaders,
      });
      expect(removeResponse.statusCode).toBe(404);
      expect(errorResponseSchema.parse(removeResponse.json()).error.code).toBe('custom_domain_not_found');
    } finally {
      configureApiRuntime({ config: defaultApiConfig, db });
    }
  });

  it('blocks viewer members from all custom-domain routes, including readonly GET access', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await deployAndCompleteSmokeWeb(installPayload.sessionToken);
    const managedApiConfig: ApiConfig = createManagedApiConfig();
    const publicIngressConfig: ApiPublicIngressConfig = createManagedPublicIngressConfig();
    configureApiRuntimeWithPublicIngress(managedApiConfig, publicIngressConfig);

    try {
      const host: string = 'viewer.customer.example.com';
      const createPayload: CreateCustomDomainResponse = await createCustomDomain(installPayload.sessionToken, host);
      const ownershipRecord: CustomDomainDnsRecord = requireCustomDomainDnsRecord(createPayload, 'ownership');
      dnsPromiseMocks.resolveTxt.mockResolvedValue([[ownershipRecord.value]]);
      dnsPromiseMocks.resolve4.mockResolvedValue([readIngressTarget(publicIngressConfig, 'A')]);
      await verifyCustomDomain(installPayload.sessionToken, host);

      const viewerSessionToken: string = await createOrganizationMemberSession(installPayload, 'viewer');
      const viewerHeaders: Record<string, string> = buildOrganizationAuthorizationHeaders(viewerSessionToken);

      const listResponse: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: '/v1/domains?projectName=smoke-web&serviceName=web',
        headers: viewerHeaders,
      });
      expect(listResponse.statusCode).toBe(403);
      expect(errorResponseSchema.parse(listResponse.json()).error.code).toBe('forbidden');

      const showResponse: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: `/v1/domains/${encodeURIComponent(host)}`,
        headers: viewerHeaders,
      });
      expect(showResponse.statusCode).toBe(404);
      expect(errorResponseSchema.parse(showResponse.json()).error.code).toBe('custom_domain_not_found');

      const verifyResponse: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: `/v1/domains/${encodeURIComponent(host)}/verify`,
        headers: viewerHeaders,
      });
      expect(verifyResponse.statusCode).toBe(404);
      expect(errorResponseSchema.parse(verifyResponse.json()).error.code).toBe('custom_domain_not_found');

      const removeResponse: LightMyRequestResponse = await app.inject({
        method: 'DELETE',
        url: `/v1/domains/${encodeURIComponent(host)}`,
        headers: viewerHeaders,
      });
      expect(removeResponse.statusCode).toBe(404);
      expect(errorResponseSchema.parse(removeResponse.json()).error.code).toBe('custom_domain_not_found');
    } finally {
      configureApiRuntime({ config: defaultApiConfig, db });
    }
  });

  it('allows deployer members to add, verify, and remove custom domains', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await deployAndCompleteSmokeWeb(installPayload.sessionToken);
    const managedApiConfig: ApiConfig = createManagedApiConfig();
    const publicIngressConfig: ApiPublicIngressConfig = createManagedPublicIngressConfig();
    configureApiRuntimeWithPublicIngress(managedApiConfig, publicIngressConfig);

    try {
      const deployerSessionToken: string = await createOrganizationMemberSession(installPayload, 'deployer');
      const deployerHeaders: Record<string, string> = buildOrganizationAuthorizationHeaders(deployerSessionToken);
      const host: string = 'deployer.customer.example.com';

      const createResponse: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: '/v1/domains',
        headers: deployerHeaders,
        payload: {
          host,
          projectName: 'smoke-web',
          serviceName: 'web',
        },
      });
      expect(createResponse.statusCode).toBe(201);
      const createPayload: CreateCustomDomainResponse = createCustomDomainResponseSchema.parse(createResponse.json());
      const ownershipRecord: CustomDomainDnsRecord = requireCustomDomainDnsRecord(createPayload, 'ownership');
      dnsPromiseMocks.resolveTxt.mockResolvedValue([[ownershipRecord.value]]);
      dnsPromiseMocks.resolve4.mockResolvedValue([readIngressTarget(publicIngressConfig, 'A')]);

      const verifyResponse: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: `/v1/domains/${encodeURIComponent(host)}/verify`,
        headers: deployerHeaders,
      });
      expect(verifyResponse.statusCode).toBe(200);
      expect(verifyCustomDomainResponseSchema.parse(verifyResponse.json()).domain).toMatchObject({
        host,
        status: 'reconciling',
      });

      const removeResponse: LightMyRequestResponse = await app.inject({
        method: 'DELETE',
        url: `/v1/domains/${encodeURIComponent(host)}`,
        headers: deployerHeaders,
      });
      expect(removeResponse.statusCode).toBe(200);
      expect(removeCustomDomainResponseSchema.parse(removeResponse.json())).toEqual({
        host,
        removed: true,
      });
    } finally {
      configureApiRuntime({ config: defaultApiConfig, db });
    }
  });

  it('keeps active custom app domain removal retryable when edge sync fails', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await deployAndCompleteSmokeWeb(installPayload.sessionToken);
    const managedApiConfig: ApiConfig = createManagedApiConfig();
    const publicIngressConfig: ApiPublicIngressConfig = createManagedPublicIngressConfig();
    configureApiRuntimeWithPublicIngress(managedApiConfig, publicIngressConfig);

    try {
      const createPayload: CreateCustomDomainResponse = await createCustomDomain(installPayload.sessionToken);
      const ownershipRecord: CustomDomainDnsRecord = requireCustomDomainDnsRecord(createPayload, 'ownership');
      dnsPromiseMocks.resolveTxt.mockResolvedValue([[ownershipRecord.value]]);
      dnsPromiseMocks.resolve4.mockResolvedValue([readIngressTarget(publicIngressConfig, 'A')]);
      const readyPayload: VerifyCustomDomainResponse = await verifyCustomDomain(installPayload.sessionToken);
      expect(readyPayload.domain.status).toBe('reconciling');
      await db
        .update(deploymentCustomDomains)
        .set({ edgeRoutingEnabled: true, reconcileState: 'active' })
        .where(eq(deploymentCustomDomains.host, defaultCustomDomainHost));
      appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState.mockClear();

      appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState.mockRejectedValueOnce(createEdgeStateUpdateFailedError());
      const failedRemoveResponse: LightMyRequestResponse = await app.inject({
        method: 'DELETE',
        url: '/v1/domains/app.customer.example.com',
        headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      });
      expect(failedRemoveResponse.statusCode).toBe(502);
      expect(errorResponseSchema.parse(failedRemoveResponse.json()).error.code).toBe('edge_state_update_failed');
      expect(await db.select().from(deploymentCustomDomains)).toEqual([
        expect.objectContaining({
          deletionReady: false,
          edgeRoutingEnabled: false,
          reconcileState: 'deleting',
        }),
      ]);

      await expect(removeCustomDomain(installPayload.sessionToken)).resolves.toEqual({
        host: 'app.customer.example.com',
        removed: true,
      });
      expect(await db.select().from(deploymentCustomDomains)).toEqual([
        expect.objectContaining({ deletionReady: true, reconcileState: 'deleting' }),
      ]);
      expect(appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState).toHaveBeenCalledTimes(2);
    } finally {
      configureApiRuntime({ config: defaultApiConfig, db });
    }
  });

  it('persists failed custom app domain verification without syncing edge state', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await deployAndCompleteSmokeWeb(installPayload.sessionToken);
    configureApiRuntimeWithPublicIngress(createManagedApiConfig(), createManagedPublicIngressConfig());
    appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState.mockClear();

    try {
      await createCustomDomain(installPayload.sessionToken);
      dnsPromiseMocks.resolveTxt.mockResolvedValue([['wrong-verification-token']]);
      dnsPromiseMocks.resolve4.mockRejectedValue(new Error('No A record.'));

      const verifyPayload: VerifyCustomDomainResponse = await verifyCustomDomain(installPayload.sessionToken);

      expect(verifyPayload.domain).toMatchObject({
        failureMessage: 'Ownership TXT and routing DNS records are not valid yet.',
        ownershipStatus: 'invalid',
        routingStatus: 'invalid',
        status: 'failed',
        verifiedAt: null,
      });
      const storedDomains: StoredCustomDomainVerificationRow[] = await db.select().from(deploymentCustomDomains);
      expect(storedDomains).toHaveLength(1);
      expect(storedDomains[0]).toMatchObject({
        failureMessage: 'Ownership TXT and routing DNS records are not valid yet.',
        ownershipStatus: 'invalid',
        routingStatus: 'invalid',
        verifiedAt: null,
      });
      expect(storedDomains[0]?.lastCheckedAt).toBeInstanceOf(Date);
      expect(appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState).not.toHaveBeenCalled();
    } finally {
      configureApiRuntime({ config: defaultApiConfig, db });
    }
  });

  it('disables Edge when an active custom app domain becomes invalid', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await deployAndCompleteSmokeWeb(installPayload.sessionToken);
    const managedApiConfig: ApiConfig = createManagedApiConfig();
    const publicIngressConfig: ApiPublicIngressConfig = createManagedPublicIngressConfig();
    configureApiRuntimeWithPublicIngress(managedApiConfig, publicIngressConfig);

    try {
      const createPayload: CreateCustomDomainResponse = await createCustomDomain(installPayload.sessionToken);
      const ownershipRecord: CustomDomainDnsRecord = requireCustomDomainDnsRecord(createPayload, 'ownership');
      dnsPromiseMocks.resolveTxt.mockResolvedValue([[ownershipRecord.value]]);
      dnsPromiseMocks.resolve4.mockResolvedValue([readIngressTarget(publicIngressConfig, 'A')]);
      const readyPayload: VerifyCustomDomainResponse = await verifyCustomDomain(installPayload.sessionToken);
      expect(readyPayload.domain.status).toBe('reconciling');
      expect(readyPayload.domain.verifiedAt).not.toBeNull();
      await db.update(deploymentCustomDomains).set({ edgeRoutingEnabled: true, reconcileState: 'active' });
      appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState.mockClear();

      dnsPromiseMocks.resolveTxt.mockResolvedValue([['wrong-verification-token']]);
      dnsPromiseMocks.resolve4.mockRejectedValue(new Error('No A record.'));

      const verifyPayload: VerifyCustomDomainResponse = await verifyCustomDomain(installPayload.sessionToken);

      expect(verifyPayload.domain).toMatchObject({
        ownershipStatus: 'invalid',
        routingStatus: 'invalid',
        status: 'failed',
        verifiedAt: readyPayload.domain.verifiedAt,
      });
      expect(appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState).toHaveBeenCalledOnce();
    } finally {
      configureApiRuntime({ config: defaultApiConfig, db });
    }
  });

  it('persists repeat invalid verification without attempting Edge activation', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await deployAndCompleteSmokeWeb(installPayload.sessionToken);
    const managedApiConfig: ApiConfig = createManagedApiConfig();
    const publicIngressConfig: ApiPublicIngressConfig = createManagedPublicIngressConfig();
    configureApiRuntimeWithPublicIngress(managedApiConfig, publicIngressConfig);

    try {
      const createPayload: CreateCustomDomainResponse = await createCustomDomain(installPayload.sessionToken);
      const ownershipRecord: CustomDomainDnsRecord = requireCustomDomainDnsRecord(createPayload, 'ownership');
      dnsPromiseMocks.resolveTxt.mockResolvedValue([[ownershipRecord.value]]);
      dnsPromiseMocks.resolve4.mockResolvedValue([readIngressTarget(publicIngressConfig, 'A')]);
      const readyPayload: VerifyCustomDomainResponse = await verifyCustomDomain(installPayload.sessionToken);
      expect(readyPayload.domain.status).toBe('reconciling');
      appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState.mockClear();

      dnsPromiseMocks.resolveTxt.mockResolvedValue([['wrong-verification-token']]);
      dnsPromiseMocks.resolve4.mockRejectedValue(new Error('No A record.'));
      const retryPayload: VerifyCustomDomainResponse = await verifyCustomDomain(installPayload.sessionToken);

      expect(retryPayload.domain).toMatchObject({
        ownershipStatus: 'invalid',
        routingStatus: 'invalid',
        status: 'failed',
        verifiedAt: readyPayload.domain.verifiedAt,
      });
      expect(appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState).not.toHaveBeenCalled();
    } finally {
      configureApiRuntime({ config: defaultApiConfig, db });
    }
  });

  it('keeps DNS verification pending and repeatable after a failed check', async (): Promise<void> => {
    await installCompartment(app);
    configureApiRuntimeWithPublicIngress(defaultApiConfig, createManagedPublicIngressConfig());

    const setResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/set',
      headers: buildSystemMutationHeaders('domain-dns-fail-set'),
      payload: buildCustomExternalDomainSetRequest(0),
    });
    expect(setResponse.statusCode).toBe(200);
    const setPayload: SystemDomainMutationResponse = systemDomainMutationResponseSchema.parse(setResponse.json());

    const verifyResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/verify',
      headers: buildSystemMutationHeaders('domain-dns-fail-verify'),
      payload: { expectedSetupVersion: 1 },
    });
    expect(verifyResponse.statusCode).toBe(200);
    const verifyPayload: SystemDomainMutationResponse = systemDomainMutationResponseSchema.parse(verifyResponse.json());
    expect(verifyPayload.status.pending?.status).toBe('pending_dns');
    expect(verifyPayload.status.pending?.failureCode).toBe('dns_ownership_invalid');

    dnsPromiseMocks.resolveTxt.mockResolvedValue([
      [requireSystemDomainDnsRecord(setPayload, 'ownership', 'TXT').value],
    ]);
    const repeatedVerifyResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/verify',
      headers: buildSystemMutationHeaders('domain-dns-repeat-verify'),
      payload: { expectedSetupVersion: 2 },
    });
    expect(repeatedVerifyResponse.statusCode).toBe(200);
    const repeatedVerifyPayload: SystemDomainMutationResponse = systemDomainMutationResponseSchema.parse(
      repeatedVerifyResponse.json(),
    );
    expect(repeatedVerifyPayload.setupVersion).toBe(3);
    expect(repeatedVerifyPayload.status.pending?.status).toBe('verified');
    expect(repeatedVerifyPayload.status.pending?.failureCode).toBeNull();
  });
});

async function deployAndCompleteSmokeWeb(sessionToken: string, organizationSlug: string = 'acme-dev'): Promise<string> {
  const deployResponse: LightMyRequestResponse = await injectDeployRequest(app, sessionToken, organizationSlug);
  expect(deployResponse.statusCode).toBe(200);
  const deployPayload: DeployResponse = deployResponseSchema.parse(deployResponse.json());
  const deployment: DeploymentSummary = requireDeployResponseDeployment(deployPayload);
  const claimedDeployment: WorkerClaimedDeployment = requireClaimedDeployment(await claimNextQueuedDeployment(app));
  await completeClaimedDeployment(app, deployment.id, claimedDeployment.routeHost);

  return claimedDeployment.routeHost;
}

const defaultCustomDomainHost: string = 'app.customer.example.com';

async function createOrganization(sessionToken: string, name: string, slug: string): Promise<void> {
  const createResponse: LightMyRequestResponse = await app.inject({
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
  expect(createResponse.statusCode).toBe(200);
}

async function createCustomDomain(
  sessionToken: string,
  host: string = defaultCustomDomainHost,
  organizationSlug: string = 'acme-dev',
): Promise<CreateCustomDomainResponse> {
  const createResponse: LightMyRequestResponse = await app.inject({
    method: 'POST',
    url: '/v1/domains',
    headers: buildOrganizationAuthorizationHeaders(sessionToken, organizationSlug),
    payload: {
      host,
      projectName: 'smoke-web',
      serviceName: 'web',
    },
  });
  expect(createResponse.statusCode).toBe(201);

  return createCustomDomainResponseSchema.parse(createResponse.json());
}

async function createDuplicateCustomDomain(
  sessionToken: string,
  host: string = defaultCustomDomainHost,
  organizationSlug: string = 'acme-dev',
): Promise<LightMyRequestResponse> {
  return await app.inject({
    method: 'POST',
    url: '/v1/domains',
    headers: buildOrganizationAuthorizationHeaders(sessionToken, organizationSlug),
    payload: {
      host,
      projectName: 'smoke-web',
      serviceName: 'web',
    },
  });
}

async function verifyCustomDomain(
  sessionToken: string,
  host: string = defaultCustomDomainHost,
): Promise<VerifyCustomDomainResponse> {
  const verifyResponse: LightMyRequestResponse = await app.inject({
    method: 'POST',
    url: `/v1/domains/${encodeURIComponent(host)}/verify`,
    headers: buildOrganizationAuthorizationHeaders(sessionToken),
  });
  expect(verifyResponse.statusCode).toBe(200);

  return verifyCustomDomainResponseSchema.parse(verifyResponse.json());
}

async function listCustomDomains(sessionToken: string): Promise<CustomDomainSummary[]> {
  const listResponse: LightMyRequestResponse = await app.inject({
    method: 'GET',
    url: '/v1/domains?projectName=smoke-web&serviceName=web',
    headers: buildOrganizationAuthorizationHeaders(sessionToken),
  });
  expect(listResponse.statusCode).toBe(200);

  return listCustomDomainsResponseSchema.parse(listResponse.json()).domains;
}

function configureApiRuntimeWithPublicIngress(
  config: ApiConfig,
  publicIngressConfig: ApiPublicIngressConfig = createEmptyPublicIngressConfig(),
): void {
  process.env.COMPARTMENT_INGRESS_TARGETS_JSON = JSON.stringify(publicIngressConfig.targets);
  configureApiRuntime({ config, db });
}

async function showCustomDomain(
  sessionToken: string,
  host: string = defaultCustomDomainHost,
): Promise<CustomDomainResponse> {
  const showResponse: LightMyRequestResponse = await app.inject({
    method: 'GET',
    url: `/v1/domains/${encodeURIComponent(host)}`,
    headers: buildOrganizationAuthorizationHeaders(sessionToken),
  });
  expect(showResponse.statusCode).toBe(200);

  return customDomainResponseSchema.parse(showResponse.json());
}

async function removeCustomDomain(
  sessionToken: string,
  host: string = defaultCustomDomainHost,
): Promise<RemoveCustomDomainResponse> {
  const removeResponse: LightMyRequestResponse = await app.inject({
    method: 'DELETE',
    url: `/v1/domains/${encodeURIComponent(host)}`,
    headers: buildOrganizationAuthorizationHeaders(sessionToken),
  });
  expect(removeResponse.statusCode).toBe(200);

  return removeCustomDomainResponseSchema.parse(removeResponse.json());
}

function requireCustomDomainDnsRecord(
  response: CreateCustomDomainResponse,
  purpose: CustomDomainDnsRecordPurpose,
): CustomDomainDnsRecord {
  const record: CustomDomainDnsRecord | undefined = response.dnsRecords.find(
    (candidate: CustomDomainDnsRecord): boolean => candidate.purpose === purpose,
  );
  if (record === undefined) {
    throw new Error(`Expected custom domain ${purpose} DNS record.`);
  }

  return record;
}

function requireCustomDomainDnsRecords(
  response: CreateCustomDomainResponse,
  purpose: CustomDomainDnsRecordPurpose,
): CustomDomainDnsRecord[] {
  const records: CustomDomainDnsRecord[] = response.dnsRecords.filter(
    (candidate: CustomDomainDnsRecord): boolean => candidate.purpose === purpose,
  );
  if (records.length === 0) {
    throw new Error(`Expected custom domain ${purpose} DNS records.`);
  }

  return records;
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

async function createOrganizationMemberSession(
  installPayload: InstallResponse,
  role: 'deployer' | 'readonly' | 'viewer',
): Promise<string> {
  return await createOrganizationMemberSessionFixture({
    db,
    organizationId: installPayload.organization.id,
    role,
    sessionSecret: defaultApiConfig.sessionSecret,
  });
}
