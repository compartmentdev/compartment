import { compartmentAppSessionCookieName, compartmentIngressAuthorizePathname } from '@compartment/contracts';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  createAppAccessSnapshot,
  createAppSessionState,
  createEdgeTestApp,
  createJsonResponse,
  readFetchUrl,
  type FetchImplementation,
} from './edge-test.utils';

afterEach((): void => {
  vi.unstubAllGlobals();
});

describe('edge session failover', (): void => {
  it('restores a PostgreSQL-backed app session after traffic moves to another edge replica', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn<FetchImplementation>()
      .mockImplementation(async (input: string | URL | Request): Promise<Response> => {
        expect(readFetchUrl(input)).toBe('http://127.0.0.1:9443/internal/app-access/session/resolve');
        return await Promise.resolve(createJsonResponse({ session: createAppSessionState() }));
      });
    vi.stubGlobal('fetch', fetchMock);
    const { app, store } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot({ upstreamPort: 31042 }),
    });

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: compartmentIngressAuthorizePathname,
        headers: {
          cookie: `${compartmentAppSessionCookieName}=app-session-token`,
          host: 'billing.localhost',
          'x-forwarded-method': 'GET',
          'x-forwarded-uri': '/dashboard',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(store.getSession('app-session-token')?.principalId).toBe('prn_123');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it('rejects a revoked session cached by an HA replica', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn<FetchImplementation>()
      .mockImplementation(async (): Promise<Response> => {
        return await Promise.resolve(createJsonResponse({ session: null }));
      });
    vi.stubGlobal('fetch', fetchMock);
    const { app, store } = createEdgeTestApp({
      config: { replicaCount: 2 },
      sessions: [{ session: createAppSessionState(), token: 'revoked-session-token' }],
      snapshot: createAppAccessSnapshot(),
    });

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: compartmentIngressAuthorizePathname,
        headers: {
          cookie: `${compartmentAppSessionCookieName}=revoked-session-token`,
          host: 'billing.localhost',
          'x-forwarded-method': 'GET',
          'x-forwarded-uri': '/dashboard',
        },
      });

      expect(response.statusCode).toBe(302);
      expect(store.getSession('revoked-session-token')).toBeNull();
    } finally {
      await app.close();
    }
  });

  it('retains a cached session when HA revalidation is temporarily unavailable', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn<FetchImplementation>()
      .mockRejectedValue(new Error('API temporarily unavailable'));
    vi.stubGlobal('fetch', fetchMock);
    const { app, store } = createEdgeTestApp({
      config: { replicaCount: 2 },
      sessions: [{ session: createAppSessionState(), token: 'cached-session-token' }],
      snapshot: createAppAccessSnapshot(),
    });

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: compartmentIngressAuthorizePathname,
        headers: {
          cookie: `${compartmentAppSessionCookieName}=cached-session-token`,
          host: 'billing.localhost',
          'x-forwarded-method': 'GET',
          'x-forwarded-uri': '/dashboard',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(store.getSession('cached-session-token')?.principalId).toBe('prn_123');
    } finally {
      await app.close();
    }
  });
});
