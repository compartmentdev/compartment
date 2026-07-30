import { compartmentIngressAuthorizePathname } from '@compartment/contracts';
import type { LightMyRequestResponse } from 'fastify';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { createAppAccessSnapshot, createEdgeTestApp, createJsonResponse } from './edge-test.utils';

describe('edge route refresh', (): void => {
  it('refreshes a stale replica from the API before rejecting an unknown route', async (): Promise<void> => {
    const fetchMock: Mock = vi.fn(
      async (): Promise<Response> =>
        await Promise.resolve(
          createJsonResponse({
            state: createAppAccessSnapshot({
              accessMode: 'public',
              host: 'fresh.localhost',
            }),
          }),
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { app } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot(),
    });

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: compartmentIngressAuthorizePathname,
        headers: {
          host: 'fresh.localhost',
          'x-forwarded-method': 'GET',
          'x-forwarded-uri': '/',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
      await app.close();
    }
  });
});
