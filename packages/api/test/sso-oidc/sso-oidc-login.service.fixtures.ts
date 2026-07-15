import { defaultApiAuthThrottleConfig } from '../auth-throttle-config.fixture';
import type { ApiConfig } from '../../src/config';
import { defaultAuditFileSinkConfig } from '../audit-file-sink-config.fixture';

export function createSsoOidcApiConfig(): ApiConfig {
  return {
    baseDomain: 'localhost',
    bindHost: '127.0.0.1',
    caddyTlsMode: 'internal',
    controlPlaneHost: 'compartment.localhost',
    customTlsDirectory: '/etc/compartment/tls',
    databaseUrl: 'postgresql://localhost/compartment_test',
    edgeToken: 'edge-token',
    edgeUrl: 'http://edge.local',
    logLevel: 'silent',
    port: 3000,
    publicHttpPort: 80,
    publicHttpsPort: 443,
    publicProtocol: 'https',
    auditRetentionDays: 90,
    auditRetentionCleanupBatchSize: 1000,
    auditRetentionCleanupCron: '0 3 * * *',
    auditRetentionCleanupMaxBatches: 100,
    auditFileSink: defaultAuditFileSinkConfig,
    rollbackRetentionLimit: null,
    runtimeControlToken: 'runtime-control-token',
    sessionSecret: 'session-secret',
    sessionTtlMs: 3_600_000,
    sourceArchiveDirectory: '/tmp/compartment',
    sourceArchiveMaxBytes: 104_857_600,
    systemApiSocketPath: '/tmp/compartment/compartment-test-system-api.sock',
    systemToken: 'system-token',
    throttle: defaultApiAuthThrottleConfig,
    trustedOutboundHosts: [],
    variablesMasterKey: Buffer.from('11'.repeat(32), 'hex'),
  };
}
