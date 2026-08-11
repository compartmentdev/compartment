import type { ApiConfig } from '../src/config';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';

const testSecretKeyHex: string = '11'.repeat(32);

function createTestSecretKey(): Buffer {
  return Buffer.from(testSecretKeyHex, 'hex');
}

/**
 * The one API configuration test doubles start from. Every field a test does not name is
 * irrelevant to it, so a new required field lands here instead of in each suite.
 */
export function createApiTestConfig(overrides: Partial<ApiConfig> = {}): ApiConfig {
  return {
    auditFileSink: defaultAuditFileSinkConfig,
    auditRetentionCleanupBatchSize: 1000,
    auditRetentionCleanupCron: '0 3 * * *',
    auditRetentionCleanupMaxBatches: 100,
    auditRetentionDays: 90,
    baseDomain: 'localhost',
    bindHost: '127.0.0.1',
    controlPlaneHost: 'console.localhost',
    databaseUrl: 'postgresql://postgres:postgres@127.0.0.1:5432/compartment_test',
    edgeToken: 'test-edge-token',
    edgeUrl: 'http://127.0.0.1:9081',
    logLevel: 'silent',
    newProjectsPrivateByDefault: true,
    port: 9443,
    publicHttpPort: 9080,
    publicHttpsPort: 443,
    publicProtocol: 'http',
    rollbackRetentionLimit: null,
    runtimeControlToken: 'test-runtime-control-token',
    sessionSecret: 'test-secret',
    sessionTtlMs: 604_800_000,
    signupEnabled: false,
    sourceArchiveDirectory: '/tmp/compartment-test-source-archives',
    sourceArchiveMaxBytes: 104_857_600,
    systemApiSocketPath: '/tmp/compartment/compartment-test-system-api.sock',
    systemToken: 'test-system-token',
    tenantSecretsKek: createTestSecretKey(),
    throttle: defaultApiAuthThrottleConfig,
    tlsMode: 'internal',
    trustedOutboundHosts: [],
    usageMeteringIntervalMs: 60_000,
    usageRetentionDays: 400,
    variablesMasterKey: createTestSecretKey(),
    ...overrides,
  };
}
