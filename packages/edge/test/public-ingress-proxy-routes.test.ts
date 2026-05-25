import { compartmentAppSessionCookieName, compartmentIngressAuthorizePathname } from '@compartment/contracts';
import type { LightMyRequestResponse } from 'fastify';
import { describe, expect, it } from 'vitest';
import {
  createAppAccessProxyRouteTargetState,
  createAppAccessSnapshot,
  createAppSessionState,
  createEdgeTestApp,
} from './edge-test.utils';

const appSessionCookiePrefix: string = `${compartmentAppSessionCookieName}=`;

describe('edge public ingress proxy routes', (): void => {
  it('returns 503 when a matched proxy route has no active destination port', async (): Promise<void> => {
    const { app } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot({
        proxyRoutes: [
          {
            on: 'web',
            path: '/api/*',
            stripPrefix: '/api',
            target: createAppAccessProxyRouteTargetState({
              upstreamHost: null,
              upstreamPort: null,
            }),
            to: 'backoffice',
          },
        ],
      }),
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
        url: compartmentIngressAuthorizePathname,
        headers: {
          cookie: readAppSessionCookie('app-session-token'),
          host: 'billing.localhost',
          'x-forwarded-method': 'GET',
          'x-forwarded-uri': '/api/ready',
        },
      });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ error: 'unavailable' });
    } finally {
      await app.close();
    }
  });
});

function readAppSessionCookie(sessionToken: string): string {
  return `${appSessionCookiePrefix}${sessionToken}`;
}
