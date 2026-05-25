import {
  compartmentAppCallbackPathname,
  compartmentAppLogoutPathname,
  compartmentAppSessionCookieName,
  readCompartmentAppFlowCookieName,
} from '@compartment/contracts';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  createJsonResponse,
  createAppAccessExchangeResponse,
  createAppAccessSnapshot,
  createAppSessionState,
  createEdgeTestApp,
  readFetchUrl,
  readJsonRequestInitBody,
  requireSetCookieHeader,
  requireSetCookieValue,
  type AppAccessExchangeRequestBody,
  type FetchImplementation,
} from './edge-test.utils';

afterEach((): void => {
  vi.unstubAllGlobals();
});

describe('edge public auth routes', (): void => {
  it('exchanges callback codes with the API and stores the app session', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn<FetchImplementation>()
      .mockImplementation(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        expect(readFetchUrl(input)).toBe('http://127.0.0.1:9443/internal/app-access/exchange');
        expect(await readJsonRequestInitBody<AppAccessExchangeRequestBody>(init)).toEqual({
          code: 'abc',
          host: 'billing.localhost',
          state: 'flow',
        });
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-edge-token');

        return await Promise.resolve(createJsonResponse(createAppAccessExchangeResponse()));
      });
    vi.stubGlobal('fetch', fetchMock);
    const { app, store } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot(),
    });

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: `${compartmentAppCallbackPathname}?code=abc&state=flow`,
        headers: {
          cookie: `${readCompartmentAppFlowCookieName('flow')}=1`,
          host: 'billing.localhost',
        },
      });

      const appSessionCookieHeader: string = requireSetCookieHeader(
        response.headers['set-cookie'],
        compartmentAppSessionCookieName,
      );

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe('/dashboard');
      expect(requireSetCookieValue(response.headers['set-cookie'], compartmentAppSessionCookieName)).toBe(
        'app-session-token',
      );
      expect(appSessionCookieHeader).toContain('Path=/');
      expect(appSessionCookieHeader).toContain('HttpOnly');
      expect(appSessionCookieHeader).toContain('SameSite=Lax');
      expect(appSessionCookieHeader).toContain('Secure');
      expect(appSessionCookieHeader).not.toContain('Domain=');
      expect(String(response.headers['set-cookie'])).toContain(`${readCompartmentAppFlowCookieName('flow')}=;`);
      expect(store.getSession('app-session-token')?.principalId).toBe('prn_123');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it('rejects callback requests with malformed Host authority', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi.fn<FetchImplementation>();
    vi.stubGlobal('fetch', fetchMock);
    const { app } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot(),
    });

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: `${compartmentAppCallbackPathname}?code=abc&state=flow`,
        headers: {
          cookie: `${readCompartmentAppFlowCookieName('flow')}=1`,
          host: 'billing.localhost:evil',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'invalid_host_header' });
      expect(response.headers.location).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('does not redirect when the API returns an unsafe callback redirect path', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn<FetchImplementation>()
      .mockImplementation(async (): Promise<Response> => {
        return await Promise.resolve(
          createJsonResponse({
            ...createAppAccessExchangeResponse(),
            redirectPath: 'https://evil.example/phish',
          }),
        );
      });
    vi.stubGlobal('fetch', fetchMock);
    const { app, store } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot(),
    });

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: `${compartmentAppCallbackPathname}?code=abc&state=flow`,
        headers: {
          cookie: `${readCompartmentAppFlowCookieName('flow')}=1`,
          host: 'billing.localhost',
        },
      });

      expect(response.statusCode).toBe(500);
      expect(response.headers.location).toBeUndefined();
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(store.getSession('app-session-token')).toBeNull();
    } finally {
      await app.close();
    }
  });

  it('clears the flow cookie and sets a secure app session cookie on https callback', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn<FetchImplementation>()
      .mockImplementation(async (): Promise<Response> => {
        return await Promise.resolve(createJsonResponse(createAppAccessExchangeResponse()));
      });
    vi.stubGlobal('fetch', fetchMock);
    const { app } = createEdgeTestApp({
      config: {
        publicProtocol: 'https',
      },
      snapshot: createAppAccessSnapshot(),
    });

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: `${compartmentAppCallbackPathname}?code=abc&state=flow`,
        headers: {
          cookie: `${readCompartmentAppFlowCookieName('flow')}=1`,
          host: 'billing.localhost',
        },
      });
      const appSessionCookieHeader: string = requireSetCookieHeader(
        response.headers['set-cookie'],
        compartmentAppSessionCookieName,
      );
      const appFlowCookieHeader: string = requireSetCookieHeader(
        response.headers['set-cookie'],
        readCompartmentAppFlowCookieName('flow'),
      );

      expect(response.statusCode).toBe(302);
      expect(appSessionCookieHeader).toContain('Secure');
      expect(appSessionCookieHeader).not.toContain('Domain=');
      expect(appFlowCookieHeader).toContain('Secure');
    } finally {
      await app.close();
    }
  });

  it('clears the local app session and calls API logout', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn<FetchImplementation>()
      .mockImplementation(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        expect(readFetchUrl(input)).toBe('http://127.0.0.1:9443/internal/app-access/logout');
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-edge-token');

        return await Promise.resolve(createJsonResponse({ success: true as const }));
      });
    vi.stubGlobal('fetch', fetchMock);
    const { app, store } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot(),
      sessions: [
        {
          session: createAppSessionState(),
          token: 'app-session-token',
        },
        {
          session: createAppSessionState(),
          token: 'sibling-session-token',
        },
      ],
    });

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: compartmentAppLogoutPathname,
        headers: {
          cookie: `${compartmentAppSessionCookieName}=app-session-token`,
          host: 'billing.localhost',
          origin: 'http://billing.localhost',
        },
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe('/');
      expect(response.headers['set-cookie']).toContain(`${compartmentAppSessionCookieName}=`);
      expect(response.headers['set-cookie']).toContain('Secure');
      expect(response.headers['set-cookie']).not.toContain('Domain=');
      expect(store.getSession('app-session-token')).toBeNull();
      expect(store.getSession('sibling-session-token')).not.toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it('exchanges callback codes for custom hosts and stores the returned host-scoped session', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn<FetchImplementation>()
      .mockImplementation(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        expect(readFetchUrl(input)).toBe('http://127.0.0.1:9443/internal/app-access/exchange');
        expect(await readJsonRequestInitBody<AppAccessExchangeRequestBody>(init)).toEqual({
          code: 'abc',
          host: 'app.customer.example.com',
          state: 'flow',
        });

        return await Promise.resolve(
          createJsonResponse({
            appSessionToken: 'app-session-token',
            redirectPath: '/dashboard',
            session: createAppSessionState({
              host: 'app.customer.example.com',
            }),
          }),
        );
      });
    vi.stubGlobal('fetch', fetchMock);
    const { app, store } = createEdgeTestApp();

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: `${compartmentAppCallbackPathname}?code=abc&state=flow`,
        headers: {
          cookie: `${readCompartmentAppFlowCookieName('flow')}=1`,
          host: 'app.customer.example.com',
        },
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe('/dashboard');
      expect(store.getSession('app-session-token')?.host).toBe('app.customer.example.com');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it('clears custom-host app sessions and calls API logout', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn<FetchImplementation>()
      .mockImplementation(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        expect(readFetchUrl(input)).toBe('http://127.0.0.1:9443/internal/app-access/logout');
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-edge-token');

        return await Promise.resolve(createJsonResponse({ success: true as const }));
      });
    vi.stubGlobal('fetch', fetchMock);
    const { app, store } = createEdgeTestApp({
      sessions: [
        {
          session: createAppSessionState({
            host: 'app.customer.example.com',
          }),
          token: 'app-session-token',
        },
      ],
    });

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: compartmentAppLogoutPathname,
        headers: {
          cookie: `${compartmentAppSessionCookieName}=app-session-token`,
          host: 'app.customer.example.com',
          origin: 'http://app.customer.example.com',
        },
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe('/');
      expect(store.getSession('app-session-token')).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it('exchanges callback codes even when the edge snapshot does not know the route yet', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn<FetchImplementation>()
      .mockImplementation(async (input: string | URL | Request): Promise<Response> => {
        expect(readFetchUrl(input)).toBe('http://127.0.0.1:9443/internal/app-access/exchange');

        return await Promise.resolve(createJsonResponse(createAppAccessExchangeResponse()));
      });
    vi.stubGlobal('fetch', fetchMock);
    const { app, store } = createEdgeTestApp();

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: `${compartmentAppCallbackPathname}?code=abc&state=flow`,
        headers: {
          cookie: `${readCompartmentAppFlowCookieName('flow')}=1`,
          host: 'billing.localhost',
        },
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe('/dashboard');
      expect(store.getSession('app-session-token')?.principalId).toBe('prn_123');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it('rejects callback requests without the initiating login flow cookie before calling the API', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi.fn<FetchImplementation>();
    vi.stubGlobal('fetch', fetchMock);
    const { app } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot(),
    });

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: `${compartmentAppCallbackPathname}?code=abc&state=flow`,
        headers: {
          host: 'billing.localhost',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'invalid_request' });
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('does not replace an existing app session on the same host with a mismatched callback flow', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi.fn<FetchImplementation>();
    vi.stubGlobal('fetch', fetchMock);
    const { app, store } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot(),
      sessions: [
        {
          session: createAppSessionState(),
          token: 'existing-session-token',
        },
      ],
    });

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: `${compartmentAppCallbackPathname}?code=abc&state=attacker-flow`,
        headers: {
          cookie: `${compartmentAppSessionCookieName}=existing-session-token; ${readCompartmentAppFlowCookieName('victim-flow')}=1`,
          host: 'billing.localhost',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'invalid_request' });
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(store.getSession('existing-session-token')?.principalId).toBe('prn_123');
      expect(store.getSession('app-session-token')).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('rejects callback requests with an empty code before calling the API', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi.fn<FetchImplementation>();
    vi.stubGlobal('fetch', fetchMock);
    const { app } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot(),
    });

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: `${compartmentAppCallbackPathname}?code=&state=flow`,
        headers: {
          cookie: `${readCompartmentAppFlowCookieName('flow')}=1`,
          host: 'billing.localhost',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'invalid_request' });
    } finally {
      await app.close();
    }
  });

  it('keeps overlapping login flow cookies isolated by state', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn<FetchImplementation>()
      .mockImplementation(async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const requestBody: AppAccessExchangeRequestBody =
          await readJsonRequestInitBody<AppAccessExchangeRequestBody>(init);

        return await Promise.resolve(
          createJsonResponse({
            appSessionToken: `app-session-token-${requestBody.state}`,
            redirectPath: '/dashboard',
            session: createAppSessionState(),
          }),
        );
      });
    vi.stubGlobal('fetch', fetchMock);
    const { app, store } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot(),
    });

    try {
      const firstResponse: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: `${compartmentAppCallbackPathname}?code=abc&state=flow-a`,
        headers: {
          cookie:
            `${readCompartmentAppFlowCookieName('flow-a')}=1; ` + `${readCompartmentAppFlowCookieName('flow-b')}=1`,
          host: 'billing.localhost',
        },
      });

      expect(firstResponse.statusCode).toBe(302);
      expect(String(firstResponse.headers['set-cookie'])).toContain(`${readCompartmentAppFlowCookieName('flow-a')}=;`);
      expect(String(firstResponse.headers['set-cookie'])).not.toContain(
        `${readCompartmentAppFlowCookieName('flow-b')}=;`,
      );
      expect(store.getSession('app-session-token-flow-a')?.principalId).toBe('prn_123');

      const secondResponse: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: `${compartmentAppCallbackPathname}?code=def&state=flow-b`,
        headers: {
          cookie: `${readCompartmentAppFlowCookieName('flow-b')}=1`,
          host: 'billing.localhost',
        },
      });

      expect(secondResponse.statusCode).toBe(302);
      expect(String(secondResponse.headers['set-cookie'])).toContain(`${readCompartmentAppFlowCookieName('flow-b')}=;`);
      expect(store.getSession('app-session-token-flow-b')?.principalId).toBe('prn_123');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      await app.close();
    }
  });

  it('rejects callback requests with an empty state before calling the API', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi.fn<FetchImplementation>();
    vi.stubGlobal('fetch', fetchMock);
    const { app } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot(),
    });

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: `${compartmentAppCallbackPathname}?code=abc&state=`,
        headers: {
          host: 'billing.localhost',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'invalid_request' });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('logs out app sessions even when the edge snapshot does not know the route yet', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn<FetchImplementation>()
      .mockImplementation(async (input: string | URL | Request): Promise<Response> => {
        expect(readFetchUrl(input)).toBe('http://127.0.0.1:9443/internal/app-access/logout');

        return await Promise.resolve(createJsonResponse({ success: true as const }));
      });
    vi.stubGlobal('fetch', fetchMock);
    const { app, store } = createEdgeTestApp({
      sessions: [
        {
          session: createAppSessionState(),
          token: 'app-session-token',
        },
      ],
    });

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: compartmentAppLogoutPathname,
        headers: {
          cookie: `${compartmentAppSessionCookieName}=app-session-token`,
          host: 'billing.localhost',
          origin: 'http://billing.localhost',
        },
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe('/');
      expect(store.getSession('app-session-token')).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it('keeps clearing the local app session cookie when API logout fails', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi
      .fn<FetchImplementation>()
      .mockRejectedValueOnce(new Error('edge revoke failed'));
    vi.stubGlobal('fetch', fetchMock);
    const { app, store } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot(),
      sessions: [
        {
          session: createAppSessionState(),
          token: 'app-session-token',
        },
      ],
    });

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: compartmentAppLogoutPathname,
        headers: {
          cookie: `${compartmentAppSessionCookieName}=app-session-token`,
          host: 'billing.localhost',
          origin: 'http://billing.localhost',
        },
      });

      expect(response.statusCode).toBe(500);
      expect(response.headers['set-cookie']).toContain(`${compartmentAppSessionCookieName}=`);
      expect(response.headers['set-cookie']).toContain('Secure');
      expect(store.getSession('app-session-token')).toBeNull();
    } finally {
      await app.close();
    }
  });

  it('rejects cross-origin app logout requests before clearing session state or calling the API', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi.fn<FetchImplementation>();
    vi.stubGlobal('fetch', fetchMock);
    const { app, store } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot(),
      sessions: [
        {
          session: createAppSessionState(),
          token: 'app-session-token',
        },
      ],
    });

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: compartmentAppLogoutPathname,
        headers: {
          cookie: `${compartmentAppSessionCookieName}=app-session-token`,
          host: 'billing.localhost',
          origin: 'http://evil.localhost',
        },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: 'invalid_browser_request' });
      expect(store.getSession('app-session-token')).not.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('rejects app logout requests with malformed Host authority without clearing session state', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi.fn<FetchImplementation>();
    vi.stubGlobal('fetch', fetchMock);
    const { app, store } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot(),
      sessions: [
        {
          session: createAppSessionState(),
          token: 'app-session-token',
        },
      ],
    });

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: compartmentAppLogoutPathname,
        headers: {
          cookie: `${compartmentAppSessionCookieName}=app-session-token`,
          host: 'billing.localhost:evil',
          origin: 'http://billing.localhost',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'invalid_host_header' });
      expect(store.getSession('app-session-token')).not.toBeNull();
    } finally {
      await app.close();
    }
  });

  it('no longer logs out app sessions on a cross-site GET request', async (): Promise<void> => {
    const fetchMock: Mock<FetchImplementation> = vi.fn<FetchImplementation>();
    vi.stubGlobal('fetch', fetchMock);
    const { app, store } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot(),
      sessions: [
        {
          session: createAppSessionState(),
          token: 'app-session-token',
        },
      ],
    });

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: compartmentAppLogoutPathname,
        headers: {
          cookie: `${compartmentAppSessionCookieName}=app-session-token`,
          host: 'billing.localhost',
        },
      });

      expect(response.statusCode).toBe(404);
      expect(store.getSession('app-session-token')).not.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
