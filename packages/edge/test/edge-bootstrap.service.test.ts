import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { AppAccessStateResponse } from '@compartment/contracts';
import type { CompartmentRequester } from '@compartment/sdk';
import pino, { type Logger } from 'pino';
import type { EdgeConfig } from '../src/config';
import { createEdgeAppAccessStateStore } from '../src/services/app-access-state-store.service';
import type { EdgeAppAccessStateStore } from '../src/services/app-access-state-store.service.types';
import {
  bootstrapEdgeAccessStateUntilReady,
  startEdgeAccessStateRefreshLoop,
} from '../src/services/edge-bootstrap.service';
import { createAppAccessSnapshot, createAppSessionState } from './edge-test.utils';

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

const edgeConfig: EdgeConfig = {
  apiUrl: 'http://127.0.0.1:9443',
  bindHost: '127.0.0.1',
  edgeToken: 'test-edge-token',
  internalHost: '127.0.0.1',
  logLevel: 'silent',
  controlPlaneHost: 'console.localhost',
  port: 9080,
  publicProtocol: 'http',
};

describe('edge bootstrap service', (): void => {
  beforeEach((): void => {
    mocks.createCompartmentRequester.mockReturnValue(requester);
  });

  afterEach((): void => {
    vi.useRealTimers();
  });

  it('hydrates the local edge store from the API snapshot', async (): Promise<void> => {
    const store: EdgeAppAccessStateStore = createEdgeAppAccessStateStore();
    const logger: Logger = pino({ enabled: false });
    mocks.getAppAccessState.mockResolvedValue({
      state: createAppAccessSnapshot({
        upstreamPort: 31001,
      }),
    });

    await bootstrapEdgeAccessStateUntilReady(edgeConfig, store, logger);

    expect(mocks.createCompartmentRequester).toHaveBeenCalledWith({
      apiUrl: 'http://127.0.0.1:9443',
      internalToken: 'test-edge-token',
    });
    expect(store.getCompartmentUrl()).toBe('http://console.localhost:9080');
    expect(store.getRoute('billing.localhost')?.upstreamPort).toBe(31001);
  });

  it('clears any existing snapshot and sessions when the API returns null state', async (): Promise<void> => {
    const store: EdgeAppAccessStateStore = createEdgeAppAccessStateStore();
    const logger: Logger = pino({ enabled: false });
    store.replaceSnapshot(createAppAccessSnapshot());
    store.setSession('app-session-token', createAppSessionState());
    mocks.getAppAccessState.mockResolvedValue({
      state: null,
    });

    await bootstrapEdgeAccessStateUntilReady(edgeConfig, store, logger);

    expect(store.getCompartmentUrl()).toBeNull();
    expect(store.getRoute('billing.localhost')).toBeNull();
    expect(store.getSession('app-session-token')).toBeNull();
  });

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

    const bootstrapPromise: Promise<void> = bootstrapEdgeAccessStateUntilReady(edgeConfig, store, logger);
    await vi.runAllTimersAsync();
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

    const stopRefreshLoop: () => void = startEdgeAccessStateRefreshLoop(edgeConfig, store, logger);

    try {
      expect(mocks.getAppAccessState).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(5_000);

      expect(mocks.getAppAccessState).toHaveBeenCalledTimes(1);
      expect(store.getRoute('billing.localhost')?.upstreamPort).toBe(31002);

      stopRefreshLoop();
      await vi.advanceTimersByTimeAsync(5_000);

      expect(mocks.getAppAccessState).toHaveBeenCalledTimes(1);
    } finally {
      stopRefreshLoop();
    }
  });
});

function createConnectionRefusedError(): Error {
  const error: Error & { cause: { code: string } } = new Error('fetch failed') as Error & { cause: { code: string } };
  error.cause = {
    code: 'ECONNREFUSED',
  };

  return error;
}
