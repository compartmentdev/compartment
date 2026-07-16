import {
  errorResponseSchema,
  installResponseSchema,
  systemDomainMutationResponseSchema,
  systemDomainStatusResponseSchema,
  type DomainDnsRecord,
  type DomainDnsRecordPurpose,
  type DomainDnsRecordType,
  type DomainCertificateMetadata,
  type InstallResponse,
  type SystemDomainAttachCertificateRequest,
  type SystemDomainMutationResponse,
  type SystemDomainSetRequest,
  type SystemDomainStatusResponse,
} from '@compartment/contracts';
import { buildPendingSystemDomainCertificatePaths, type PendingSystemDomainCertificatePaths } from '@compartment/utils';
import type { LightMyRequestResponse } from 'fastify';
import { mkdir, rm, writeFile } from 'node:fs/promises';
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
import { readApiConfig, type ApiConfig, type ApiPublicIngressConfig } from '../src/config';
import type * as OutboundHttpService from '../src/services/outbound-http.service';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import { operations, systemDomainSetupState } from '../src/db/schema';
import { createEdgeStateUpdateFailedError } from '../src/errors/api-business-error';
import { clearApiRuntime, configureApiRuntime } from '../src/runtime/runtime';

import { installCompartment } from './api-integration.harness';
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
      caddyMode: 'custom-http',
      domainKind: 'custom',
      publicScheme: 'https',
      tlsMode: 'external',
    },
  };
}

function buildCustomCertificateDomainSetRequest(expectedSetupVersion: number): SystemDomainSetRequest {
  return {
    expectedSetupVersion,
    hostPlan: {
      baseDomain: 'customer.example.com',
      caddyMode: 'custom-cert',
      domainKind: 'custom',
      publicScheme: 'https',
      tlsMode: 'custom-cert',
    },
  };
}

function buildCustomCertificateAttachRequest(expectedSetupVersion: number): SystemDomainAttachCertificateRequest {
  return {
    expectedSetupVersion,
  };
}

function buildStoredPendingCertificateMetadata(): DomainCertificateMetadata {
  return {
    dnsNames: ['*.customer.example.com', 'console.customer.example.com'],
    expiresAt: '2036-01-01T00:00:00.000Z',
    fingerprintSha256:
      'A8:37:27:37:39:FE:45:8A:DB:29:E6:78:F1:DE:4A:6F:16:5B:C5:41:48:7A:0A:A4:CE:9A:80:F1:54:B7:0A:43',
    issuedAt: '2020-01-01T00:00:00.000Z',
    issuer: 'CN=*.customer.example.com',
    serialNumber: '79A5FA68142CE72CA06E2F4E3DE4DE3C4BAE5656',
    subject: 'CN=*.customer.example.com',
  };
}

async function writePendingCertificateFixture(
  operationId: string,
  overrides: { certificatePem?: string; privateKeyPem?: string } = {},
): Promise<void> {
  const pendingPaths: PendingSystemDomainCertificatePaths = readPendingCertificateFixturePaths(operationId);
  const tlsDirectory: string = resolve(pendingPaths.certificatePath, '..');

  await mkdir(tlsDirectory, { recursive: true });
  await writeFile(pendingPaths.certificatePath, overrides.certificatePem ?? testPendingCertificatePem, 'utf8');
  await writeFile(pendingPaths.privateKeyPath, overrides.privateKeyPem ?? testPendingPrivateKeyPem, 'utf8');
}

function readPendingCertificateFixturePaths(operationId: string): PendingSystemDomainCertificatePaths {
  return buildPendingSystemDomainCertificatePaths(defaultApiConfig.customTlsDirectory, operationId);
}

function createCustomHttpApiConfig(): ApiConfig {
  return {
    ...defaultApiConfig,
    baseDomain: 'customer.example.com',
    caddyTlsMode: 'custom-http',
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

function createCustomCertificateApiConfig(): ApiConfig {
  return {
    ...defaultApiConfig,
    baseDomain: 'customer.example.com',
    caddyTlsMode: 'custom-cert',
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

function createManagedApiConfig(): ApiConfig {
  return {
    ...defaultApiConfig,
    baseDomain: '4h8z9k2m1p7q.app.compartment.run',
    caddyTlsMode: 'managed',
    controlPlaneHost: 'console.4h8z9k2m1p7q.app.compartment.run',
    publicProtocol: 'https',
    auditRetentionDays: 90,
    auditRetentionCleanupBatchSize: 1000,
    auditRetentionCleanupCron: '0 3 * * *',
    auditRetentionCleanupMaxBatches: 100,
    auditFileSink: defaultAuditFileSinkConfig,
    rollbackRetentionLimit: null,
  };
}

const testPendingCertificatePem: string = `-----BEGIN CERTIFICATE-----
MIIDZjCCAk6gAwIBAgIUeaX6aBQs5yygbi9OPeTePEuuVlYwDQYJKoZIhvcNAQEL
BQAwITEfMB0GA1UEAwwWKi5jdXN0b21lci5leGFtcGxlLmNvbTAeFw0yMDAxMDEw
MDAwMDBaFw0zNjAxMDEwMDAwMDBaMCExHzAdBgNVBAMMFiouY3VzdG9tZXIuZXhh
bXBsZS5jb20wggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQCPjBkYO2Ug
ktjaZ8e45CW6dVg3jFv8UMavbDWP/RRIUEqB9jD/G3dTZOwlkopXTFVPn3UUFQ5c
CLTg24iagLWqu1QFiDdlfauTUZPqaISF5UWfUWaraap3cnQPsip+i5TcQx5akni7
ZZLr+5bu1t0G+cwfDy5WkPDXgojxCL/HzUP5lXvr/sm40m4sqdsXvPW/9sltLjEH
Rz16EFgMchTMff8kmrfdoD1PJJcZytk3N43qgGMRUhBt0U16kf/+igdO7tb9vIWf
9ISAx8RQEj+cQfWGiLi0zGZDrp79ApDxvLJlHWvjS4KgyokR35ZVjgWj/DBpjSvV
zlICJvRE0sa9AgMBAAGjgZUwgZIwHQYDVR0OBBYEFFpwzIVWPE0n5Ro3RgQMLSu3
W5hZMB8GA1UdIwQYMBaAFFpwzIVWPE0n5Ro3RgQMLSu3W5hZMA8GA1UdEwEB/wQF
MAMBAf8wPwYDVR0RBDgwNoIWKi5jdXN0b21lci5leGFtcGxlLmNvbYIcY29uc29s
ZS5jdXN0b21lci5leGFtcGxlLmNvbTANBgkqhkiG9w0BAQsFAAOCAQEAAgfK0N8n
aENeDBWAbm774S/X/MvLT6l/a1fhOy45CBe4eKLO2RNRt3L9wG1fZgi2IcQ5Xfif
J6orBT+WdbexVoq1RXEMnCKDk6lIINv/s2px2ArXT6yWl324c8H+Yf0JG9v/qJE1
25KD9la+/B3i6T+gH39HgOOr3ahp6VnbSZ2CNSnjgJQjj6CzO9XPbJdGB3bFFwuN
VDnEuxLSUl/tT9tjQB+fNsoa7aW8fbuRcwOEMCP9DFDD+5iKIc7K9qmgI6f6CAYV
9UPWVqnn1hYIwEG9rYxcCIc/Xs9AfxFcsSY7qsepbx12bSQC9fUP5EL8kg5Leip3
L7RAHor0FFHL5w==
-----END CERTIFICATE-----
`;
const testPendingPrivateKeyPem: string = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCPjBkYO2Ugktja
Z8e45CW6dVg3jFv8UMavbDWP/RRIUEqB9jD/G3dTZOwlkopXTFVPn3UUFQ5cCLTg
24iagLWqu1QFiDdlfauTUZPqaISF5UWfUWaraap3cnQPsip+i5TcQx5akni7ZZLr
+5bu1t0G+cwfDy5WkPDXgojxCL/HzUP5lXvr/sm40m4sqdsXvPW/9sltLjEHRz16
EFgMchTMff8kmrfdoD1PJJcZytk3N43qgGMRUhBt0U16kf/+igdO7tb9vIWf9ISA
x8RQEj+cQfWGiLi0zGZDrp79ApDxvLJlHWvjS4KgyokR35ZVjgWj/DBpjSvVzlIC
JvRE0sa9AgMBAAECggEAMsoLBvvc6A2NFJmrnMt8XeCu+dh7o2ahJehPe0a8Kmne
MuV8qIZ7TdJji1eyAvlLJgTxU82vavjZpsWGK8RmgqYNMHflwc8ZKeKvRzz7xrQ8
UgZnITcdzW19iyAq0ONqJBTLZJh2hzeFKGG4IYF8ar9vbX3dk1ttG5NgCIhj8rky
Jwhz0RfNLv1NI488nGaKnjN5nATivhLZJ7c/4RakOXzGvbGsZ3TjbPkkgQ8O+jCZ
Bv+4X+T+HIGykcuDzuCa46AEu6ZvsDl2z1QxjaYX1gZADpqBC87uCZH3kg9lo2KN
5mAOyD5CGoWml5wsa7tYxMBa3XGdorgcy2xosHX4sQKBgQDEPjGCZyET6IuSx9hj
dq0kbY0ypKpxhNWoWhgVTScmp4MSgC52zlF4yQFmtfpY8cquLzGuMG/Ce57AZhBm
BeKMefyqaLt0e2x7pru/fEuCCe8YEshB44tu4kXeyfWtH5BWzcRqw4KNSvMUHipe
+/HR3qbSMHIHQi7cdg/KyWcLLwKBgQC7QhimK6peyTpQXb+UjvcZNRxamQOmvzD7
29NCK17VD0lDWMVY8DRIlppoJAHIualAGE1BlDSvs5RgnaWH1sdBjYGEHMN4USpK
uxnrdWieFWn7eNifupl9AWdTNdgIZklQJK9IIaDVnohw4BHoygB8XrxPoVH04RsS
DuGjT+Sh0wKBgQC6c4jgqBGCc9CgreXHYstQsBGWi2Mxpg7F/IujOYG4NTHQkx8S
XCaGRxxgtQfeGCUE5+wg3v5gXsnPbWmpNXAxHfnVAtsP6fCBb0I0xeiL7dpQGhBQ
odwphyzxZxtX2IRwJOK4uXdBvXNEqwCA7ImuaAhB7it5AAW8CyQn/ME9mwKBgHrp
epZv6OdIfA9OSbbwVD7mfpL1BtGHg1Z9xuAS6a891l/vP7IOELNorzcWE1m2i+J3
URZvelmtrQHx2DoefzGG+XFHFALAe9sLjorfyOiis6sNelr1t1O2/SRAHmn9Abgq
LCdTc2dkJLi6Suca2FDKOh6mi84Jh6RFwlNY2IBjAoGBAJE3GyaAIqS6l8MsxvcO
7BsSD+BswxQqz9ezjMge2fU3ejLDPRGKwMdbt0eHCxNapjfWIISakYa2HZ4+yVuF
1NUVt2+hOccmCYFdgLdUzdn87PcR1ynghOrxAXPrQXwA1I0gl0Gw1ZYm3U7WIOg7
DseN3Yi5o8Sy6/8VkiFu7TYK
-----END PRIVATE KEY-----
`;

const { testDatabaseUrl } = readDatabaseTestMode();
const apiIntegrationDatabaseUrl: string = deriveProcessScopedDatabaseUrl(
  testDatabaseUrl,
  'api_integration_system_domain',
);
process.env.COMPARTMENT_DATABASE_URL = apiIntegrationDatabaseUrl;
const testCustomTlsDirectory: string = resolve(tmpdir(), 'compartment-api-integration-system-domain-tls');
process.env.COMPARTMENT_SESSION_SECRET = process.env.COMPARTMENT_SESSION_SECRET ?? 'test-secret';
process.env.COMPARTMENT_ENV = 'dev';
process.env.COMPARTMENT_BASE_DOMAIN = 'localhost';
process.env.COMPARTMENT_CADDY_TLS_MODE = 'internal';
process.env.COMPARTMENT_CUSTOM_TLS_DIR = testCustomTlsDirectory;
process.env.COMPARTMENT_PUBLIC_PROTOCOL = 'http';
process.env.COMPARTMENT_PUBLIC_HTTP_PORT = '80';
process.env.COMPARTMENT_PUBLIC_HTTPS_PORT = '443';
process.env.COMPARTMENT_PUBLIC_INGRESS_IPV4 = '';
process.env.COMPARTMENT_PUBLIC_INGRESS_IPV6 = '';
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
    await rm(testCustomTlsDirectory, { force: true, recursive: true });
    await mkdir(testCustomTlsDirectory, { recursive: true });
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
    await rm(testCustomTlsDirectory, { force: true, recursive: true });
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
      caddyMode: 'internal',
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
        payload: buildCustomCertificateAttachRequest(0),
        url: '/internal/system/domain/attach-cert',
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
      publicIngressIpv4: alternatePublicIpv4Address,
      publicIngressIpv6: null,
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

  it('verifies DNS, activates custom HTTP domain state, and syncs edge', async (): Promise<void> => {
    await installCompartment(app);
    configureApiRuntimeWithPublicIngress(defaultApiConfig, createManagedPublicIngressConfig());
    appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState.mockClear();

    const setResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/set',
      headers: buildSystemMutationHeaders('domain-custom-http-set'),
      payload: buildCustomExternalDomainSetRequest(0),
    });
    expect(setResponse.statusCode).toBe(200);
    const setPayload: SystemDomainMutationResponse = systemDomainMutationResponseSchema.parse(setResponse.json());
    const ownershipRecord: DomainDnsRecord = requireSystemDomainDnsRecord(setPayload, 'ownership', 'TXT');
    dnsPromiseMocks.resolveTxt.mockResolvedValue([[ownershipRecord.value]]);

    const verifyResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/verify',
      headers: buildSystemMutationHeaders('domain-custom-http-verify'),
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
      headers: buildSystemMutationHeaders('domain-custom-http-activate'),
      payload: { expectedSetupVersion: 2 },
    });
    expect(activateResponse.statusCode).toBe(200);
    const activatePayload: SystemDomainMutationResponse = systemDomainMutationResponseSchema.parse(
      activateResponse.json(),
    );
    expect(activatePayload.status.pending).toBeNull();
    expect(activatePayload.status.active).toEqual({
      baseDomain: 'customer.example.com',
      caddyMode: 'custom-http',
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

  it('attaches a provided certificate before verifying and activating custom HTTPS domain state', async (): Promise<void> => {
    await installCompartment(app);
    configureApiRuntimeWithPublicIngress(defaultApiConfig, createManagedPublicIngressConfig());
    appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState.mockClear();

    const setResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/set',
      headers: buildSystemMutationHeaders('domain-custom-cert-set'),
      payload: buildCustomCertificateDomainSetRequest(0),
    });
    expect(setResponse.statusCode).toBe(200);
    const setPayload: SystemDomainMutationResponse = systemDomainMutationResponseSchema.parse(setResponse.json());
    expect(setPayload.status.pending?.status).toBe('pending_dns');
    expect(setPayload.status.pending?.certificate).toBeNull();
    dnsPromiseMocks.resolveTxt.mockResolvedValue([
      [requireSystemDomainDnsRecord(setPayload, 'ownership', 'TXT').value],
    ]);

    const verifyWithoutCertResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/verify',
      headers: buildSystemMutationHeaders('domain-custom-cert-verify-without-cert'),
      payload: { expectedSetupVersion: 1 },
    });
    expect(verifyWithoutCertResponse.statusCode).toBe(409);
    expect(errorResponseSchema.parse(verifyWithoutCertResponse.json()).error.code).toBe('domain_operation_unavailable');

    await writePendingCertificateFixture(setPayload.operationId);

    const attachResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/attach-cert',
      headers: buildSystemMutationHeaders('domain-custom-cert-attach'),
      payload: buildCustomCertificateAttachRequest(1),
    });
    expect(attachResponse.statusCode).toBe(200);
    const attachPayload: SystemDomainMutationResponse = systemDomainMutationResponseSchema.parse(attachResponse.json());
    expect(attachPayload.status.pending?.status).toBe('pending_cert');
    expect(attachPayload.status.pending?.certificate?.certificatePath).toBe(
      readPendingCertificateFixturePaths(setPayload.operationId).certificatePath,
    );
    expect(attachPayload.status.pending?.certificate?.privateKeyPath).toBe(
      readPendingCertificateFixturePaths(setPayload.operationId).privateKeyPath,
    );
    expect(attachPayload.status.pending?.certificate?.metadata.dnsNames).toEqual([
      '*.customer.example.com',
      'console.customer.example.com',
    ]);
    const [storedPendingSetupState]: SystemDomainSetupStateRecord[] = await db.select().from(systemDomainSetupState);
    expect(storedPendingSetupState?.pendingCertificatePath).toBeNull();
    expect(storedPendingSetupState?.pendingPrivateKeyPath).toBeNull();

    const verifyResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/verify',
      headers: buildSystemMutationHeaders('domain-custom-cert-verify'),
      payload: { expectedSetupVersion: 2 },
    });
    expect(verifyResponse.statusCode).toBe(200);
    const verifyPayload: SystemDomainMutationResponse = systemDomainMutationResponseSchema.parse(verifyResponse.json());
    expect(verifyPayload.status.pending?.status).toBe('verified');

    configureApiRuntime({ config: createCustomCertificateApiConfig(), db });
    const activateResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/activate',
      headers: buildSystemMutationHeaders('domain-custom-cert-activate'),
      payload: { expectedSetupVersion: 3 },
    });
    expect(activateResponse.statusCode).toBe(200);
    const activatePayload: SystemDomainMutationResponse = systemDomainMutationResponseSchema.parse(
      activateResponse.json(),
    );
    expect(activatePayload.status.pending).toBeNull();
    expect(activatePayload.status.active).toEqual({
      baseDomain: 'customer.example.com',
      caddyMode: 'custom-cert',
      domainKind: 'custom',
      publicScheme: 'https',
      tlsMode: 'custom-cert',
    });
    expect(appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState).toHaveBeenCalledTimes(1);
  });

  it('rejects legacy attach-cert payload fields after the contract is narrowed', async (): Promise<void> => {
    await installCompartment(app);
    configureApiRuntimeWithPublicIngress(defaultApiConfig, createManagedPublicIngressConfig());

    const setResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/set',
      headers: buildSystemMutationHeaders('domain-custom-cert-legacy-set'),
      payload: buildCustomCertificateDomainSetRequest(0),
    });
    expect(setResponse.statusCode).toBe(200);
    const setPayload: SystemDomainMutationResponse = systemDomainMutationResponseSchema.parse(setResponse.json());
    await writePendingCertificateFixture(setPayload.operationId);

    const attachResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/attach-cert',
      headers: buildSystemMutationHeaders('domain-custom-cert-legacy-attach'),
      payload: {
        certificate: {
          certificatePath: '/etc/compartment/tls/domop_123/fullchain.pem',
          metadata: buildStoredPendingCertificateMetadata(),
          privateKeyPath: '/etc/compartment/tls/domop_123/privkey.pem',
        },
        expectedSetupVersion: 1,
      },
    });

    expect(attachResponse.statusCode).toBe(400);
    expect(errorResponseSchema.parse(attachResponse.json()).error.code).toBe(
      'invalid_system_domain_attach_certificate_request',
    );
  });

  it('returns canonical pending certificate paths even when stored values are poisoned', async (): Promise<void> => {
    await installCompartment(app);
    configureApiRuntimeWithPublicIngress(defaultApiConfig, createManagedPublicIngressConfig());

    const setResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/set',
      headers: buildSystemMutationHeaders('domain-custom-cert-poisoned-set'),
      payload: buildCustomCertificateDomainSetRequest(0),
    });
    expect(setResponse.statusCode).toBe(200);
    const setPayload: SystemDomainMutationResponse = systemDomainMutationResponseSchema.parse(setResponse.json());

    await db
      .update(systemDomainSetupState)
      .set({
        pendingCertificateMetadataJson: JSON.stringify(buildStoredPendingCertificateMetadata()),
        pendingCertificatePath: '/etc/compartment/tls/domop_123/fullchain.pem\nINJECTED=value',
        pendingPrivateKeyPath: '/etc/compartment/tls/domop_123/privkey.pem\nSECOND=value',
        pendingStatus: 'pending_cert',
      })
      .where(eq(systemDomainSetupState.pendingOperationId, setPayload.operationId));

    const statusResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'GET',
      url: '/internal/system/domain/status',
      headers: buildSystemAuthorizationHeaders(),
    });
    expect(statusResponse.statusCode).toBe(200);
    const statusPayload: SystemDomainStatusResponse = systemDomainStatusResponseSchema.parse(statusResponse.json());
    expect(statusPayload.pending?.certificate?.certificatePath).toBe(
      readPendingCertificateFixturePaths(setPayload.operationId).certificatePath,
    );
    expect(statusPayload.pending?.certificate?.privateKeyPath).toBe(
      readPendingCertificateFixturePaths(setPayload.operationId).privateKeyPath,
    );
  });

  it('returns a business error when the staged certificate files are missing or malformed', async (): Promise<void> => {
    await installCompartment(app);
    configureApiRuntimeWithPublicIngress(defaultApiConfig, createManagedPublicIngressConfig());

    const setResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/set',
      headers: buildSystemMutationHeaders('domain-custom-cert-invalid-set'),
      payload: buildCustomCertificateDomainSetRequest(0),
    });
    expect(setResponse.statusCode).toBe(200);
    const setPayload: SystemDomainMutationResponse = systemDomainMutationResponseSchema.parse(setResponse.json());

    const missingFilesAttachResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/attach-cert',
      headers: buildSystemMutationHeaders('domain-custom-cert-invalid-missing'),
      payload: buildCustomCertificateAttachRequest(1),
    });
    expect(missingFilesAttachResponse.statusCode).toBe(409);
    expect(errorResponseSchema.parse(missingFilesAttachResponse.json()).error.code).toBe(
      'domain_operation_unavailable',
    );

    await writePendingCertificateFixture(setPayload.operationId, {
      certificatePem: 'not a certificate',
      privateKeyPem: testPendingPrivateKeyPem,
    });
    const malformedAttachResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/attach-cert',
      headers: buildSystemMutationHeaders('domain-custom-cert-invalid-malformed'),
      payload: buildCustomCertificateAttachRequest(1),
    });
    expect(malformedAttachResponse.statusCode).toBe(409);
    expect(errorResponseSchema.parse(malformedAttachResponse.json()).error.code).toBe('domain_operation_unavailable');
  });

  it('revalidates staged certificate files when verify runs after attach', async (): Promise<void> => {
    await installCompartment(app);
    configureApiRuntimeWithPublicIngress(defaultApiConfig, createManagedPublicIngressConfig());

    const setResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/set',
      headers: buildSystemMutationHeaders('domain-custom-cert-verify-revalidation-set'),
      payload: buildCustomCertificateDomainSetRequest(0),
    });
    expect(setResponse.statusCode).toBe(200);
    const setPayload: SystemDomainMutationResponse = systemDomainMutationResponseSchema.parse(setResponse.json());

    await writePendingCertificateFixture(setPayload.operationId);
    const attachResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/attach-cert',
      headers: buildSystemMutationHeaders('domain-custom-cert-verify-revalidation-attach'),
      payload: buildCustomCertificateAttachRequest(1),
    });
    expect(attachResponse.statusCode).toBe(200);

    await rm(readPendingCertificateFixturePaths(setPayload.operationId).certificatePath, { force: true });
    const verifyResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/verify',
      headers: buildSystemMutationHeaders('domain-custom-cert-verify-revalidation-verify'),
      payload: { expectedSetupVersion: 2 },
    });

    expect(verifyResponse.statusCode).toBe(409);
    expect(errorResponseSchema.parse(verifyResponse.json()).error.code).toBe('domain_operation_unavailable');
  });

  it('revalidates staged certificate files when activate runs after verify', async (): Promise<void> => {
    await installCompartment(app);
    configureApiRuntimeWithPublicIngress(defaultApiConfig, createManagedPublicIngressConfig());

    const setResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/set',
      headers: buildSystemMutationHeaders('domain-custom-cert-activate-revalidation-set'),
      payload: buildCustomCertificateDomainSetRequest(0),
    });
    expect(setResponse.statusCode).toBe(200);
    const setPayload: SystemDomainMutationResponse = systemDomainMutationResponseSchema.parse(setResponse.json());

    await writePendingCertificateFixture(setPayload.operationId);
    const attachResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/attach-cert',
      headers: buildSystemMutationHeaders('domain-custom-cert-activate-revalidation-attach'),
      payload: buildCustomCertificateAttachRequest(1),
    });
    expect(attachResponse.statusCode).toBe(200);

    const verifyResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/verify',
      headers: buildSystemMutationHeaders('domain-custom-cert-activate-revalidation-verify'),
      payload: { expectedSetupVersion: 2 },
    });
    expect(verifyResponse.statusCode).toBe(200);

    await writeFile(
      readPendingCertificateFixturePaths(setPayload.operationId).privateKeyPath,
      'not a private key',
      'utf8',
    );
    configureApiRuntime({ config: createCustomCertificateApiConfig(), db });
    const activateResponse: LightMyRequestResponse = await systemApp.inject({
      method: 'POST',
      url: '/internal/system/domain/activate',
      headers: buildSystemMutationHeaders('domain-custom-cert-activate-revalidation-activate'),
      payload: { expectedSetupVersion: 3 },
    });

    expect(activateResponse.statusCode).toBe(409);
    expect(errorResponseSchema.parse(activateResponse.json()).error.code).toBe('domain_operation_unavailable');
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
      caddyMode: 'managed',
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
  process.env.COMPARTMENT_PUBLIC_INGRESS_IPV4 = publicIngressConfig.publicIngressIpv4 ?? '';
  process.env.COMPARTMENT_PUBLIC_INGRESS_IPV6 = publicIngressConfig.publicIngressIpv6 ?? '';
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
