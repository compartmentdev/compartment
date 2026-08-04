import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';
import { type ApiConfig } from '../src/config';
import type { Database } from '../src/db/client';
import { isApiBusinessError, mapApiBusinessError } from '../src/errors/api-business-error';
import { clearApiRuntime, configureApiRuntime } from '../src/runtime/runtime';
import {
  invalidateEdgeAppAccessSessions,
  synchronizeEdgeAppAccessState,
} from '../src/services/app-access-edge.service';
import type { readAppAccessState } from '../src/services/app-access-state.service';

type FetchEdgeInternalHttp = (path: string, init?: RequestInit) => Promise<Response>;

interface AppAccessEdgeServiceMocks {
  fetchEdgeInternalHttp: Mock<FetchEdgeInternalHttp>;
  readAppAccessState: Mock<typeof readAppAccessState>;
}

const mocks: AppAccessEdgeServiceMocks = vi.hoisted(
  (): AppAccessEdgeServiceMocks => ({
    fetchEdgeInternalHttp: vi.fn<FetchEdgeInternalHttp>(),
    readAppAccessState: vi.fn<typeof readAppAccessState>(),
  }),
);

vi.mock('node:timers/promises', (): object => ({ setTimeout: vi.fn() }));

vi.mock('../src/services/outbound-http.service', (): { fetchEdgeInternalHttp: Mock<FetchEdgeInternalHttp> } => ({
  fetchEdgeInternalHttp: mocks.fetchEdgeInternalHttp,
}));

vi.mock('../src/services/app-access-state.service', (): { readAppAccessState: Mock<typeof readAppAccessState> } => ({
  readAppAccessState: mocks.readAppAccessState,
}));

vi.mock('../src/services/resource-operation-lock.service', (): object => ({
  withResourceOperationLocks: async <Result>(
    _resourceIds: string[],
    operation: () => Promise<Result>,
  ): Promise<Result> => await operation(),
}));

const apiConfig: ApiConfig = {
  bindHost: '127.0.0.1',
  builderProfileDigest: 'sha256:' + 'e'.repeat(64),
  baseDomain: 'localhost',
  tlsMode: 'internal',
  controlPlaneHost: 'console.localhost',
  databaseUrl: 'postgresql://postgres:postgres@127.0.0.1:5432/compartment_test',
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
  sessionSecret: 'test-session-secret',
  sessionTtlMs: 604_800_000,
  sourceArchiveDirectory: '/tmp/compartment-test-source-archives',
  sourceArchiveMaxBytes: 104_857_600,
  throttle: defaultApiAuthThrottleConfig,
  systemApiSocketPath: '/tmp/compartment/compartment-app-access-edge-system-api.sock',
  systemToken: 'test-system-token',
  trustedOutboundHosts: [],
  tenantSecretsKek: Buffer.from('11'.repeat(32), 'hex'),
  variablesMasterKey: Buffer.from('11'.repeat(32), 'hex'),
  runtimeControlToken: 'test-runtime-control-token',
};

describe('app access edge service', (): void => {
  beforeEach((): void => {
    configureApiRuntime({
      config: apiConfig,
      db: {} as Database,
    });
    mocks.readAppAccessState.mockResolvedValue({
      compartmentUrl: 'http://console.localhost:9080',
      grants: [],
      routes: [],
    });
  });

  afterEach((): void => {
    clearApiRuntime();
    mocks.fetchEdgeInternalHttp.mockReset();
    mocks.readAppAccessState.mockReset();
  });

  it('retries transient edge sync failures before succeeding', async (): Promise<void> => {
    const fetchMock: Mock<FetchEdgeInternalHttp> = mocks.fetchEdgeInternalHttp
      .mockReset()
      .mockRejectedValueOnce(new Error('socket closed'))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await synchronizeEdgeAppAccessState();

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('sends an empty edge snapshot when installation is not complete', async (): Promise<void> => {
    mocks.readAppAccessState.mockResolvedValue(null);
    const fetchMock: Mock<FetchEdgeInternalHttp> = mocks.fetchEdgeInternalHttp.mockResolvedValue(
      new Response(null, { status: 204 }),
    );

    await synchronizeEdgeAppAccessState();

    const requestInit: RequestInit | undefined = fetchMock.mock.calls[0]?.[1];

    expect(requestInit?.body).toBe(JSON.stringify({ state: null }));
  });

  it('raises a business error when edge session invalidation still fails after retries', async (): Promise<void> => {
    const fetchMock: Mock<FetchEdgeInternalHttp> = mocks.fetchEdgeInternalHttp.mockResolvedValue(
      new Response('unavailable', { status: 503 }),
    );

    try {
      await invalidateEdgeAppAccessSessions('auth_123');
      throw new Error('Expected edge invalidation to fail.');
    } catch (error) {
      const edgeError: Error = error as Error;
      expect(edgeError).toBeInstanceOf(Error);
      expect(isApiBusinessError(edgeError)).toBe(true);
      if (!isApiBusinessError(edgeError)) {
        throw new Error('Expected an API business error.');
      }

      const mappedError: { code: string; statusCode: number } = mapApiBusinessError(edgeError);

      expect(mappedError.code).toBe('edge_state_update_failed');
      expect(mappedError.statusCode).toBe(502);
    }

    expect(fetchMock).toHaveBeenCalledTimes(10);
  });
});
