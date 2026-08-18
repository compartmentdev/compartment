import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  compartmentAppSessionCookieName,
  compartmentIngressAuthorizePathname,
  type AppAccessStateResponse,
  type AppAccessStateSnapshot,
} from '@compartment/contracts';
import type { CompartmentRequester } from '@compartment/sdk';
import type { LightMyRequestResponse } from 'fastify';
import pino, { type Logger } from 'pino';
import { access, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EdgeConfig } from '../src/config';
import { createEdgeAppAccessStateStore } from '../src/services/app-access-state-store.service';
import type { EdgeAppAccessStateStore } from '../src/services/app-access-state-store.service.types';
import { createEdgeSnapshotMetrics } from '../src/services/edge-snapshot-metrics.service';
import type { EdgeSnapshotMetrics } from '../src/services/edge-snapshot-metrics.service.types';
import {
  bootstrapEdgeAccessStateUntilReady,
  startEdgeAccessStateRefreshLoop,
} from '../src/services/edge-bootstrap.service';
import { createAppAccessSnapshot, createAppSessionState, createEdgeTestApp } from './edge-test.utils';

interface EdgeRequesterOptions {
  apiUrl: string;
  internalToken: string;
}

type CreateCompartmentRequester = (defaultOptions: EdgeRequesterOptions) => CompartmentRequester;
type GetAppAccessState = (request: CompartmentRequester) => Promise<AppAccessStateResponse>;

interface EdgeBootstrapServiceMocks {
  createCompartmentRequester: Mock<CreateCompartmentRequester>;
  getAppAccessState: Mock<GetAppAccessState>;
}

const requester: CompartmentRequester = vi.fn() as CompartmentRequester;

const mocks: EdgeBootstrapServiceMocks = vi.hoisted(
  (): EdgeBootstrapServiceMocks => ({
    createCompartmentRequester: vi.fn<CreateCompartmentRequester>(),
    getAppAccessState: vi.fn<GetAppAccessState>(),
  }),
);

vi.mock(
  '@compartment/sdk',
  (): { createCompartmentRequester: Mock<CreateCompartmentRequester>; getAppAccessState: Mock<GetAppAccessState> } => ({
    createCompartmentRequester: mocks.createCompartmentRequester,
    getAppAccessState: mocks.getAppAccessState,
  }),
);
vi.mock('node:fs/promises', { spy: true });

const edgeConfig: EdgeConfig = {
  apiUrl: 'http://127.0.0.1:9443',
  bindHost: '127.0.0.1',
  edgeToken: 'test-edge-token',
  internalHost: '127.0.0.1',
  logLevel: 'silent',
  metricsPort: 9464,
  controlPlaneHost: 'console.localhost',
  port: 9080,
  publicProtocol: 'http',
  replicaCount: 1,
  snapshotMaxAgeMs: 86_400_000,
  snapshotPath: '/tmp/compartment-edge-test/access-state.json',
};

describe('edge bootstrap service', (): void => {
  let temporaryDirectory: string;

  beforeEach(async (): Promise<void> => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'edge-bootstrap-'));
    edgeConfig.snapshotPath = join(temporaryDirectory, 'access-state.json');
    mocks.createCompartmentRequester.mockReturnValue(requester);
  });

  afterEach(async (): Promise<void> => {
    vi.useRealTimers();
    mocks.getAppAccessState.mockReset();
    vi.mocked(writeFile).mockClear();
    vi.mocked(rename).mockClear();
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('hydrates the local edge store from the API snapshot', async (): Promise<void> => {
    const store: EdgeAppAccessStateStore = createEdgeAppAccessStateStore();
    const logger: Logger = pino({ enabled: false });
    mocks.getAppAccessState.mockResolvedValue({
      state: createAppAccessSnapshot({
        upstreamPort: 31001,
      }),
    });

    await bootstrapEdgeAccessStateUntilReady(edgeConfig, store, createEdgeSnapshotMetrics(), logger);

    expect(mocks.createCompartmentRequester).toHaveBeenCalledWith({
      apiUrl: 'http://127.0.0.1:9443',
      internalToken: 'test-edge-token',
    });
    expect(store.getCompartmentUrl()).toBe('http://console.localhost:9080');
    expect(store.getRoute('billing.localhost')?.upstreamPort).toBe(31001);
    expect(JSON.parse(await readFile(edgeConfig.snapshotPath, 'utf8'))).toMatchObject({
      state: { routes: [{ upstreamPort: 31001 }] },
    });
    expect((await stat(temporaryDirectory)).mode & 0o777).toBe(0o700);
    expect((await stat(edgeConfig.snapshotPath)).mode & 0o777).toBe(0o600);
  });

  it('starts from a fresh persisted snapshot when the API is unavailable', async (): Promise<void> => {
    const store: EdgeAppAccessStateStore = createEdgeAppAccessStateStore();
    const logger: Logger = pino({ enabled: false });
    const metrics: EdgeSnapshotMetrics = createEdgeSnapshotMetrics();
    await writePersistedSnapshot(createAppAccessSnapshot({ upstreamPort: 31003 }));
    mocks.getAppAccessState.mockRejectedValue(createConnectionRefusedError());

    await bootstrapEdgeAccessStateUntilReady(edgeConfig, store, metrics, logger);

    expect(store.getRoute('billing.localhost')?.upstreamPort).toBe(31003);
    expect(mocks.getAppAccessState).toHaveBeenCalledTimes(1);
    expect(await metrics.registry.metrics()).toContain('compartment_edge_snapshot_restore_source{source="disk"} 1');
  });

  it('restores a fresh persisted snapshot without retrying when the API connection times out', async (): Promise<void> => {
    const store: EdgeAppAccessStateStore = createEdgeAppAccessStateStore();
    const logger: Logger = pino({ enabled: false });
    const metrics: EdgeSnapshotMetrics = createEdgeSnapshotMetrics();
    await writePersistedSnapshot(createAppAccessSnapshot({ upstreamPort: 31003 }));
    mocks.getAppAccessState.mockRejectedValue(createConnectTimeoutError());

    await bootstrapEdgeAccessStateUntilReady(edgeConfig, store, metrics, logger);

    expect(store.getRoute('billing.localhost')?.upstreamPort).toBe(31003);
    expect(mocks.getAppAccessState).toHaveBeenCalledTimes(1);
    expect(await metrics.registry.metrics()).toContain('compartment_edge_snapshot_restore_source{source="disk"} 1');
  });

  it('does not retry an API connection timeout without a valid persisted snapshot', async (): Promise<void> => {
    const store: EdgeAppAccessStateStore = createEdgeAppAccessStateStore();
    mocks.getAppAccessState.mockRejectedValue(createConnectTimeoutError());

    await expect(
      bootstrapEdgeAccessStateUntilReady(edgeConfig, store, createEdgeSnapshotMetrics(), pino({ enabled: false })),
    ).rejects.toThrow('fetch failed');

    expect(mocks.getAppAccessState).toHaveBeenCalledTimes(1);
  });

  it('redirects a stale pre-restart session to login after restoring authorization from disk', async (): Promise<void> => {
    await writePersistedSnapshot(createAppAccessSnapshot());
    mocks.getAppAccessState.mockRejectedValue(createConnectionRefusedError());
    const { app } = createEdgeTestApp({ config: { snapshotPath: edgeConfig.snapshotPath } });

    try {
      await bootstrapEdgeAccessStateUntilReady(edgeConfig, app.edgeStore, app.edgeSnapshotMetrics, app.log);
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: compartmentIngressAuthorizePathname,
        headers: {
          cookie: `${compartmentAppSessionCookieName}=stale-session-token`,
          host: 'billing.localhost',
          'x-forwarded-method': 'GET',
          'x-forwarded-uri': '/dashboard',
        },
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toMatch(/^http:\/\/console\.localhost:9080\/login\?/);
      expect(String(response.headers['set-cookie'])).toContain(`${compartmentAppSessionCookieName}=;`);
    } finally {
      await app.close();
    }
  });

  it.each([
    ['corrupt JSON', '{not-json'],
    ['contract-invalid state', JSON.stringify({ persistedAt: new Date().toISOString(), state: {} })],
    [
      'future timestamp from clock skew',
      JSON.stringify({
        persistedAt: new Date(Date.now() + 60_000).toISOString(),
        state: createAppAccessSnapshot({ upstreamPort: 31003 }),
      }),
    ],
  ])('fails closed for %s and waits for the API', async (_caseName: string, diskContents: string): Promise<void> => {
    vi.useFakeTimers();
    const store: EdgeAppAccessStateStore = createEdgeAppAccessStateStore();
    await writeFile(edgeConfig.snapshotPath, diskContents);
    mocks.getAppAccessState
      .mockRejectedValueOnce(createConnectionRefusedError())
      .mockResolvedValueOnce({ state: createAppAccessSnapshot({ upstreamPort: 31004 }) });

    const bootstrapPromise: Promise<void> = bootstrapEdgeAccessStateUntilReady(
      edgeConfig,
      store,
      createEdgeSnapshotMetrics(),
      pino({ enabled: false }),
    );
    await vi.waitFor((): void => {
      expect(vi.getTimerCount()).toBe(1);
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await bootstrapPromise;

    expect(store.getRoute('billing.localhost')?.upstreamPort).toBe(31004);
  });

  it('ignores a partial temporary write and restores the last complete snapshot', async (): Promise<void> => {
    const store: EdgeAppAccessStateStore = createEdgeAppAccessStateStore();
    await writePersistedSnapshot(createAppAccessSnapshot({ upstreamPort: 31003 }));
    await writeFile(`${edgeConfig.snapshotPath}.999.tmp`, '{partial');
    mocks.getAppAccessState.mockRejectedValue(createConnectionRefusedError());

    await bootstrapEdgeAccessStateUntilReady(edgeConfig, store, createEdgeSnapshotMetrics(), pino({ enabled: false }));

    expect(store.getRoute('billing.localhost')?.upstreamPort).toBe(31003);
  });

  it('keeps the previous complete snapshot when rename fails after a partial write', async (): Promise<void> => {
    const store: EdgeAppAccessStateStore = createEdgeAppAccessStateStore();
    await writePersistedSnapshot(createAppAccessSnapshot({ upstreamPort: 31003 }));
    vi.mocked(rename).mockRejectedValueOnce(createFilesystemError('EIO'));
    mocks.getAppAccessState.mockResolvedValue({ state: createAppAccessSnapshot({ upstreamPort: 31004 }) });

    await expect(
      bootstrapEdgeAccessStateUntilReady(edgeConfig, store, createEdgeSnapshotMetrics(), pino({ enabled: false })),
    ).rejects.toThrow();

    expect(JSON.parse(await readFile(edgeConfig.snapshotPath, 'utf8'))).toMatchObject({
      state: { routes: [{ upstreamPort: 31003 }] },
    });
    expect((await readdir(temporaryDirectory)).filter((name: string): boolean => name.endsWith('.tmp'))).toEqual([]);
  });

  it('prefers a live API snapshot over a valid disk snapshot after restart', async (): Promise<void> => {
    const store: EdgeAppAccessStateStore = createEdgeAppAccessStateStore();
    await writePersistedSnapshot(createAppAccessSnapshot({ upstreamPort: 31003 }));
    mocks.getAppAccessState.mockResolvedValue({ state: createAppAccessSnapshot({ upstreamPort: 31004 }) });

    await bootstrapEdgeAccessStateUntilReady(edgeConfig, store, createEdgeSnapshotMetrics(), pino({ enabled: false }));

    expect(store.getRoute('billing.localhost')?.upstreamPort).toBe(31004);
  });

  it('fails closed for an expired persisted snapshot and waits for the API', async (): Promise<void> => {
    vi.useFakeTimers();
    const store: EdgeAppAccessStateStore = createEdgeAppAccessStateStore();
    const logger: Logger = pino({ enabled: false });
    const metrics: EdgeSnapshotMetrics = createEdgeSnapshotMetrics();
    await writePersistedSnapshot(createAppAccessSnapshot({ upstreamPort: 31003 }), '2020-01-01T00:00:00.000Z');
    mocks.getAppAccessState
      .mockRejectedValueOnce(createConnectionRefusedError())
      .mockResolvedValueOnce({ state: createAppAccessSnapshot({ upstreamPort: 31004 }) });

    const bootstrapPromise: Promise<void> = bootstrapEdgeAccessStateUntilReady(edgeConfig, store, metrics, logger);
    await vi.waitFor((): void => {
      expect(vi.getTimerCount()).toBe(1);
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await bootstrapPromise;

    expect(store.getRoute('billing.localhost')?.upstreamPort).toBe(31004);
    expect(mocks.getAppAccessState).toHaveBeenCalledTimes(2);
    expect(await metrics.registry.metrics()).toContain('compartment_edge_snapshot_fail_closed_expiry_total 1');
  });

  it('clears any existing snapshot and sessions when the API returns null state', async (): Promise<void> => {
    const store: EdgeAppAccessStateStore = createEdgeAppAccessStateStore();
    const logger: Logger = pino({ enabled: false });
    store.replaceSnapshot(createAppAccessSnapshot());
    store.setSession('app-session-token', createAppSessionState());
    await writePersistedSnapshot(createAppAccessSnapshot());
    mocks.getAppAccessState.mockResolvedValue({
      state: null,
    });

    await bootstrapEdgeAccessStateUntilReady(edgeConfig, store, createEdgeSnapshotMetrics(), logger);

    expect(store.getCompartmentUrl()).toBeNull();
    expect(store.getRoute('billing.localhost')).toBeNull();
    expect(store.getSession('app-session-token')).toBeNull();
    await expect(access(edgeConfig.snapshotPath)).rejects.toThrow();
  });

  it.each(['ENOSPC', 'EACCES'])(
    'does not publish API state after a %s snapshot write error',
    async (code: string): Promise<void> => {
      const store: EdgeAppAccessStateStore = createEdgeAppAccessStateStore();
      const metrics: EdgeSnapshotMetrics = createEdgeSnapshotMetrics();
      vi.mocked(writeFile).mockRejectedValueOnce(createFilesystemError(code));
      mocks.getAppAccessState.mockResolvedValue({ state: createAppAccessSnapshot({ upstreamPort: 31004 }) });

      await expect(
        bootstrapEdgeAccessStateUntilReady(edgeConfig, store, metrics, pino({ enabled: false })),
      ).rejects.toThrow();
      expect(store.getRoute('billing.localhost')).toBeNull();
      expect(await metrics.registry.metrics()).toContain('compartment_edge_snapshot_persistence_errors_total 1');
    },
  );

  it('retries bootstrap until the API becomes reachable', async (): Promise<void> => {
    vi.useFakeTimers();
    const store: EdgeAppAccessStateStore = createEdgeAppAccessStateStore();
    const logger: Logger = pino({ enabled: false });
    mocks.getAppAccessState
      .mockRejectedValueOnce(createConnectionRefusedError())
      .mockRejectedValueOnce(createConnectionRefusedError())
      .mockResolvedValueOnce({
        state: createAppAccessSnapshot({
          upstreamPort: 31002,
        }),
      });

    const bootstrapPromise: Promise<void> = bootstrapEdgeAccessStateUntilReady(
      edgeConfig,
      store,
      createEdgeSnapshotMetrics(),
      logger,
    );
    await vi.waitFor((): void => {
      expect(vi.getTimerCount()).toBe(1);
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor((): void => {
      expect(vi.getTimerCount()).toBe(1);
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await bootstrapPromise;

    expect(mocks.getAppAccessState).toHaveBeenCalledTimes(3);
    expect(store.getRoute('billing.localhost')?.upstreamPort).toBe(31002);
  });

  it('refreshes the local edge store on an interval after startup bootstrap', async (): Promise<void> => {
    vi.useFakeTimers();
    const store: EdgeAppAccessStateStore = createEdgeAppAccessStateStore();
    const logger: Logger = pino({ enabled: false });
    store.replaceSnapshot(
      createAppAccessSnapshot({
        upstreamPort: 31001,
      }),
    );
    mocks.getAppAccessState.mockResolvedValue({
      state: createAppAccessSnapshot({
        upstreamPort: 31002,
      }),
    });

    const stopRefreshLoop: () => void = startEdgeAccessStateRefreshLoop(
      edgeConfig,
      store,
      createEdgeSnapshotMetrics(),
      logger,
    );

    try {
      expect(mocks.getAppAccessState).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(5_000);
      await vi.waitFor((): void => {
        expect(store.getRoute('billing.localhost')?.upstreamPort).toBe(31002);
      });

      expect(mocks.getAppAccessState).toHaveBeenCalledTimes(1);
      expect(store.getRoute('billing.localhost')?.upstreamPort).toBe(31002);

      stopRefreshLoop();
      await vi.advanceTimersByTimeAsync(5_000);

      expect(mocks.getAppAccessState).toHaveBeenCalledTimes(1);
    } finally {
      stopRefreshLoop();
    }
  });

  it('records refresh failures without replacing the last-known-good state', async (): Promise<void> => {
    vi.useFakeTimers();
    const store: EdgeAppAccessStateStore = createEdgeAppAccessStateStore();
    const metrics: EdgeSnapshotMetrics = createEdgeSnapshotMetrics();
    store.replaceSnapshot(createAppAccessSnapshot({ upstreamPort: 31001 }));
    mocks.getAppAccessState.mockRejectedValue(new Error('refresh failed'));
    const stopRefreshLoop: () => void = startEdgeAccessStateRefreshLoop(
      edgeConfig,
      store,
      metrics,
      pino({ enabled: false }),
    );

    await vi.advanceTimersByTimeAsync(5_000);

    expect(store.getRoute('billing.localhost')?.upstreamPort).toBe(31001);
    expect(await metrics.registry.metrics()).toContain('compartment_edge_snapshot_refresh_errors_total 1');
    stopRefreshLoop();
  });

  it('serializes slow refreshes instead of overlapping snapshot writes', async (): Promise<void> => {
    vi.useFakeTimers();
    const store: EdgeAppAccessStateStore = createEdgeAppAccessStateStore();
    let resolveFirstRefresh: ((response: AppAccessStateResponse) => void) | undefined;
    mocks.getAppAccessState
      .mockImplementationOnce(
        async (): Promise<AppAccessStateResponse> =>
          await new Promise<AppAccessStateResponse>((resolve: (response: AppAccessStateResponse) => void): void => {
            resolveFirstRefresh = resolve;
          }),
      )
      .mockResolvedValue({ state: createAppAccessSnapshot({ upstreamPort: 31002 }) });
    const stopRefreshLoop: () => void = startEdgeAccessStateRefreshLoop(
      edgeConfig,
      store,
      createEdgeSnapshotMetrics(),
      pino({ enabled: false }),
    );

    await vi.advanceTimersByTimeAsync(15_000);
    expect(mocks.getAppAccessState).toHaveBeenCalledTimes(1);
    resolveFirstRefresh?.({ state: createAppAccessSnapshot({ upstreamPort: 31001 }) });
    await vi.waitFor((): void => {
      expect(store.getRoute('billing.localhost')?.upstreamPort).toBe(31001);
    });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mocks.getAppAccessState).toHaveBeenCalledTimes(2);
    await vi.waitFor((): void => {
      expect(store.getRoute('billing.localhost')?.upstreamPort).toBe(31002);
    });
    stopRefreshLoop();
  });
});

async function writePersistedSnapshot(
  state: AppAccessStateSnapshot,
  persistedAt: string = new Date().toISOString(),
): Promise<void> {
  await writeFile(edgeConfig.snapshotPath, JSON.stringify({ persistedAt, state }));
}

function createConnectionRefusedError(): Error {
  const error: Error & { cause: { code: string } } = new Error('fetch failed') as Error & { cause: { code: string } };
  error.cause = {
    code: 'ECONNREFUSED',
  };

  return error;
}

function createConnectTimeoutError(): Error {
  const error: Error & { cause: { code: string } } = new Error('fetch failed') as Error & { cause: { code: string } };
  error.cause = {
    code: 'UND_ERR_CONNECT_TIMEOUT',
  };

  return error;
}

function createFilesystemError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}
