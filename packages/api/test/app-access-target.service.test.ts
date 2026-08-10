import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';
import { type ApiConfig } from '../src/config';
import type { getApiConfig } from '../src/runtime/runtime';
import { buildAppCallbackUrl, requireKnownBrowserFlowTarget } from '../src/services/app-access-target.service';

type GetApiConfig = typeof getApiConfig;

interface AppAccessTargetServiceMocks {
  getApiConfig: Mock<GetApiConfig>;
}

interface RuntimeMockModule {
  getApiConfig: Mock<GetApiConfig>;
}

const mocks: AppAccessTargetServiceMocks = vi.hoisted(
  (): AppAccessTargetServiceMocks => ({
    getApiConfig: vi.fn<GetApiConfig>(),
  }),
);

vi.mock(
  '../src/runtime/runtime',
  (): RuntimeMockModule => ({
    getApiConfig: mocks.getApiConfig,
  }),
);

const apiConfig: ApiConfig = {
  bindHost: '127.0.0.1',
  baseDomain: 'localhost',
  tlsMode: 'internal',
  controlPlaneHost: 'console.localhost',
  databaseUrl: 'postgresql://127.0.0.1:5432/compartment_test',
  edgeToken: 'test-edge-token',
  edgeUrl: 'http://127.0.0.1:9080',
  logLevel: 'silent',
  port: 9443,
  publicProtocol: 'http',
  auditRetentionDays: 90,
  auditRetentionCleanupBatchSize: 1000,
  auditRetentionCleanupCron: '0 3 * * *',
  auditRetentionCleanupMaxBatches: 100,
  usageMeteringIntervalMs: 60_000,
  usageRetentionDays: 400,
  auditFileSink: defaultAuditFileSinkConfig,
  rollbackRetentionLimit: null,
  publicHttpPort: 9080,
  publicHttpsPort: 443,
  sessionSecret: 'test-secret',
  sessionTtlMs: 604_800_000,
  signupEnabled: false,
  sourceArchiveDirectory: '/tmp/compartment-test-source-archives',
  sourceArchiveMaxBytes: 104_857_600,
  throttle: defaultApiAuthThrottleConfig,
  systemApiSocketPath: '/tmp/compartment/compartment-app-access-target-system-api.sock',
  systemToken: 'test-system-token',
  trustedOutboundHosts: [],
  tenantSecretsKek: Buffer.from('11'.repeat(32), 'hex'),
  variablesMasterKey: Buffer.from('11'.repeat(32), 'hex'),
  runtimeControlToken: 'test-runtime-control-token',
};

describe('app access target service', (): void => {
  beforeEach((): void => {
    mocks.getApiConfig.mockReturnValue(apiConfig);
  });

  it('rejects protocol-relative browser flow paths', async (): Promise<void> => {
    await expect(
      requireKnownBrowserFlowTarget({
        host: 'billing.localhost',
        path: '//attacker.example',
        state: 'flow',
      }),
    ).rejects.toMatchObject({
      code: 'invalid_browser_flow',
    });
  });

  it('rejects traversal browser flow paths', async (): Promise<void> => {
    await expect(
      requireKnownBrowserFlowTarget({
        host: 'billing.localhost',
        path: '/app%5c..%5cadmin',
        state: 'flow',
      }),
    ).rejects.toMatchObject({
      code: 'invalid_browser_flow',
    });
  });

  it('builds app callback URLs on the configured public localhost port', (): void => {
    mocks.getApiConfig.mockReturnValue({
      ...apiConfig,
      publicHttpPort: 38080,
    });

    expect(buildAppCallbackUrl('billing.localhost', 'code_123', 'flow')).toBe(
      'http://billing.localhost:38080/_compartment/callback?code=code_123&state=flow',
    );
  });

  it('builds app callback URLs on verified custom hosts', (): void => {
    mocks.getApiConfig.mockReturnValue({
      ...apiConfig,
      publicHttpPort: 38080,
    });

    expect(buildAppCallbackUrl('app.customer.example.com', 'code_123', 'flow')).toBe(
      'http://app.customer.example.com:38080/_compartment/callback?code=code_123&state=flow',
    );
  });
});
