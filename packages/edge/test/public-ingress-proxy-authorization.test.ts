import {
  compartmentAccessModeHeaderName,
  compartmentAppSessionCookieName,
  compartmentIngressAuthorizePathname,
  compartmentPrincipalEmailHeaderName,
  compartmentPrincipalIdHeaderName,
  compartmentProxyPathHeaderName,
  compartmentUpstreamHostHeaderName,
  compartmentUpstreamPortHeaderName,
} from '@compartment/contracts';
import type { LightMyRequestResponse } from 'fastify';
import { describe, expect, it } from 'vitest';
import {
  createAppAccessProxyRouteTargetState,
  createAppAccessSnapshot,
  createAppSessionState,
  createEdgeTestApp,
} from './edge-test.utils';

const appSessionCookiePrefix: string = `${compartmentAppSessionCookieName}=`;
const compartmentAccessModeResponseHeaderName: string = compartmentAccessModeHeaderName.toLowerCase();
const compartmentPrincipalEmailResponseHeaderName: string = compartmentPrincipalEmailHeaderName.toLowerCase();
const compartmentPrincipalIdResponseHeaderName: string = compartmentPrincipalIdHeaderName.toLowerCase();
const compartmentProxyPathResponseHeaderName: string = compartmentProxyPathHeaderName.toLowerCase();
const compartmentUpstreamHostResponseHeaderName: string = compartmentUpstreamHostHeaderName.toLowerCase();
const compartmentUpstreamPortResponseHeaderName: string = compartmentUpstreamPortHeaderName.toLowerCase();

describe('edge public ingress proxy authorization', (): void => {
  it('returns proxy path and destination route port for authorized proxied app requests', async (): Promise<void> => {
    const { app } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot({
        proxyRoutes: [
          {
            on: 'web',
            path: '/api/*',
            stripPrefix: '/api',
            target: createAppAccessProxyRouteTargetState(),
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
          'x-compartment-upstream-host': 'app.cpt-project.svc',
          'x-compartment-upstream-port': '31042',
          'x-compartment-proxy-path': '/ready?via=browser',
          'x-forwarded-method': 'GET',
          'x-forwarded-uri': '/api/ready?via=browser',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers[compartmentUpstreamHostResponseHeaderName]).toBe('app.cpt-project.svc');
      expect(response.headers[compartmentUpstreamPortResponseHeaderName]).toBe('31042');
      expect(response.headers[compartmentProxyPathResponseHeaderName]).toBe('/ready?via=browser');
    } finally {
      await app.close();
    }
  });

  it('preserves authenticated trusted headers when an authenticated source route proxies to a public target', async (): Promise<void> => {
    const { app } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot({
        proxyRoutes: [
          {
            on: 'web',
            path: '/api/*',
            stripPrefix: '/api',
            target: createAppAccessProxyRouteTargetState({ accessMode: 'public' }),
            to: 'backoffice',
          },
        ],
      }),
      sessions: [{ session: createAppSessionState(), token: 'app-session-token' }],
    });

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: compartmentIngressAuthorizePathname,
        headers: {
          cookie: readAppSessionCookie('app-session-token'),
          host: 'billing.localhost',
          'x-compartment-upstream-host': 'app.cpt-project.svc',
          'x-compartment-upstream-port': '31042',
          'x-compartment-proxy-path': '/ready?via=browser',
          'x-forwarded-method': 'GET',
          'x-forwarded-uri': '/api/ready?via=browser',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers[compartmentAccessModeResponseHeaderName]).toBe('authenticated');
      expect(response.headers[compartmentPrincipalEmailResponseHeaderName]).toBe('admin@example.com');
      expect(response.headers[compartmentPrincipalIdResponseHeaderName]).toBe('prn_123');
      expect(response.headers[compartmentUpstreamPortResponseHeaderName]).toBe('31042');
      expect(response.headers[compartmentProxyPathResponseHeaderName]).toBe('/ready?via=browser');
    } finally {
      await app.close();
    }
  });

  it('redirects unauthenticated public source proxy requests when the target route is authenticated', async (): Promise<void> => {
    const { app } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot({
        accessMode: 'public',
        proxyRoutes: [
          {
            on: 'web',
            path: '/api/*',
            stripPrefix: '/api',
            target: createAppAccessProxyRouteTargetState(),
            to: 'backoffice',
          },
        ],
      }),
    });

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: compartmentIngressAuthorizePathname,
        headers: {
          host: 'billing.localhost',
          'x-compartment-upstream-host': 'app.cpt-project.svc',
          'x-compartment-upstream-port': '31000',
          'x-forwarded-method': 'GET',
          'x-forwarded-uri': '/api/ready?via=browser',
        },
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toMatch(
        /^http:\/\/console\.localhost:9080\/login\?host=billing\.localhost&path=%2Fapi%2Fready%3Fvia%3Dbrowser&state=/,
      );
    } finally {
      await app.close();
    }
  });

  it('allows public source proxy requests with a session authorized for the authenticated target route', async (): Promise<void> => {
    const { app } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot({
        accessMode: 'public',
        grants: [
          {
            permissions: ['app.route.access'],
            principalId: 'prn_123',
            scopeId: 'env_backoffice',
            scopeType: 'environment',
          },
        ],
        proxyRoutes: [
          {
            on: 'web',
            path: '/api/*',
            stripPrefix: '/api',
            target: createAppAccessProxyRouteTargetState({
              routeScopeId: 'env_backoffice',
              routeScopeType: 'environment',
              scopeChain: [
                { scopeId: 'env_backoffice', scopeType: 'environment' },
                { scopeId: 'prj_123', scopeType: 'project' },
                { scopeId: 'org_123', scopeType: 'organization' },
              ],
            }),
            to: 'backoffice',
          },
        ],
      }),
      sessions: [{ session: createAppSessionState(), token: 'app-session-token' }],
    });

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: compartmentIngressAuthorizePathname,
        headers: {
          cookie: readAppSessionCookie('app-session-token'),
          host: 'billing.localhost',
          'x-compartment-upstream-host': 'app.cpt-project.svc',
          'x-compartment-upstream-port': '31042',
          'x-compartment-proxy-path': '/ready?via=browser',
          'x-forwarded-method': 'GET',
          'x-forwarded-uri': '/api/ready?via=browser',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers[compartmentAccessModeResponseHeaderName]).toBe('authenticated');
      expect(response.headers[compartmentPrincipalEmailResponseHeaderName]).toBe('admin@example.com');
      expect(response.headers[compartmentUpstreamPortResponseHeaderName]).toBe('31042');
      expect(response.headers[compartmentProxyPathResponseHeaderName]).toBe('/ready?via=browser');
    } finally {
      await app.close();
    }
  });
});

function readAppSessionCookie(sessionToken: string): string {
  return `${appSessionCookiePrefix}${sessionToken}`;
}
