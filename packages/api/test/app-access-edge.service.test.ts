import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { type ApiConfig } from '../src/config';
import type { Database } from '../src/db/client';
import { isApiBusinessError, mapApiBusinessError } from '../src/errors/api-business-error';
import { clearApiRuntime, configureApiRuntime } from '../src/runtime/runtime';
import {
  invalidateEdgeAppAccessSessions,
  synchronizeEdgeAppAccessState,
} from '../src/services/app-access-edge.service';
import type { readAppAccessState } from '../src/services/app-access-state.service';
import { createApiTestConfig } from './api-config-test.fixtures';

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

const apiConfig: ApiConfig = createApiTestConfig();

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
