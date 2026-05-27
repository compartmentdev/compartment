import {
  compartmentAccessModeHeaderName,
  compartmentAppSessionCookieName,
  compartmentIngressAuthorizePathname,
  compartmentOrganizationIdHeaderName,
  compartmentOrganizationSlugHeaderName,
  compartmentPrincipalEmailHeaderName,
  compartmentPrincipalIdHeaderName,
  compartmentPrincipalTypeHeaderName,
  compartmentProxyPathHeaderName,
  readCompartmentAppFlowCookieName,
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
  requireSetCookieHeader,
  requireSetCookieValue,
} from './edge-test.utils';

const legacyCompartmentAppSessionCookieName: string = 'compartment_app_session';
const appSessionCookiePrefix: string = `${compartmentAppSessionCookieName}=`;
const compartmentAccessModeResponseHeaderName: string = compartmentAccessModeHeaderName.toLowerCase();
const compartmentOrganizationIdResponseHeaderName: string = compartmentOrganizationIdHeaderName.toLowerCase();
const compartmentOrganizationSlugResponseHeaderName: string = compartmentOrganizationSlugHeaderName.toLowerCase();
const compartmentPrincipalEmailResponseHeaderName: string = compartmentPrincipalEmailHeaderName.toLowerCase();
const compartmentPrincipalIdResponseHeaderName: string = compartmentPrincipalIdHeaderName.toLowerCase();
const compartmentPrincipalTypeResponseHeaderName: string = compartmentPrincipalTypeHeaderName.toLowerCase();
const compartmentProxyPathResponseHeaderName: string = compartmentProxyPathHeaderName.toLowerCase();
const compartmentUpstreamHostResponseHeaderName: string = compartmentUpstreamHostHeaderName.toLowerCase();
const compartmentUpstreamPortResponseHeaderName: string = compartmentUpstreamPortHeaderName.toLowerCase();

describe('edge public ingress routes', (): void => {
  it('returns 404 for compartment-host authorize requests', async (): Promise<void> => {
    const { app } = createEdgeTestApp();

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: compartmentIngressAuthorizePathname,
        headers: {
          host: 'console.localhost',
          'x-forwarded-method': 'GET',
          'x-forwarded-uri': '/dashboard',
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'route_not_found' });
    } finally {
      await app.close();
    }
  });

  it('returns 404 for unknown route hosts', async (): Promise<void> => {
    const { app } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot(),
    });

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: compartmentIngressAuthorizePathname,
        headers: {
          host: 'unknown.localhost',
          'x-forwarded-method': 'GET',
          'x-forwarded-uri': '/dashboard',
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'route_not_found' });
    } finally {
      await app.close();
    }
  });

  it('redirects unauthenticated app requests to compartment login', async (): Promise<void> => {
    const { app } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot(),
    });

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: compartmentIngressAuthorizePathname,
        headers: {
          host: 'billing.localhost',
          'x-forwarded-method': 'GET',
          'x-forwarded-uri': '/dashboard',
        },
      });

      expect(response.statusCode).toBe(302);
      const loginUrl: URL = new URL(response.headers.location ?? '');
      const loginFlowState: string = loginUrl.searchParams.get('state') ?? '';
      const flowCookieName: string = readCompartmentAppFlowCookieName(loginFlowState);
      const flowCookieHeader: string = requireSetCookieHeader(response.headers['set-cookie'], flowCookieName);

      expect(loginUrl.toString()).toMatch(
        /^http:\/\/console\.localhost:9080\/login\?host=billing\.localhost&path=%2Fdashboard&state=/,
      );
      expect(loginFlowState).not.toBe('');
      expect(requireSetCookieValue(response.headers['set-cookie'], flowCookieName)).toBe('1');
      expect(flowCookieHeader).toContain('Secure');
      expect(flowCookieHeader).not.toContain('Domain=');
    } finally {
      await app.close();
    }
  });

  it('returns 404 for protocol-relative forwarded paths before login redirect handling', async (): Promise<void> => {
    const { app } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot(),
    });

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: compartmentIngressAuthorizePathname,
        headers: {
          host: 'billing.localhost',
          'x-forwarded-method': 'GET',
          'x-forwarded-uri': '//attacker.example',
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'route_not_found' });
      expect(response.headers.location).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('redirects custom-host requests to compartment login and clears sessions from a different host', async (): Promise<void> => {
    const { app } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot({
        host: 'app.customer.example.com',
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
          host: 'app.customer.example.com',
          'x-forwarded-method': 'GET',
          'x-forwarded-uri': '/dashboard',
        },
      });

      expect(response.statusCode).toBe(302);
      const loginUrl: URL = new URL(response.headers.location ?? '');
      const loginFlowState: string = loginUrl.searchParams.get('state') ?? '';
      const flowCookieName: string = readCompartmentAppFlowCookieName(loginFlowState);
      const flowCookieHeader: string = requireSetCookieHeader(response.headers['set-cookie'], flowCookieName);

      expect(loginUrl.searchParams.get('host')).toBe('app.customer.example.com');
      expect(loginFlowState).not.toBe('');
      expect(String(response.headers['set-cookie'])).toContain(`${compartmentAppSessionCookieName}=;`);
      expect(String(response.headers['set-cookie'])).toContain('Secure');
      expect(String(response.headers['set-cookie'])).not.toContain('Domain=');
      expect(requireSetCookieValue(response.headers['set-cookie'], flowCookieName)).toBe('1');
      expect(flowCookieHeader).toContain('Secure');
      expect(flowCookieHeader).not.toContain('Domain=');
    } finally {
      await app.close();
    }
  });

  it('allows unauthenticated requests for public routes', async (): Promise<void> => {
    const { app } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot({
        accessMode: 'public',
        upstreamPort: 31042,
      }),
    });

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: compartmentIngressAuthorizePathname,
        headers: {
          host: 'billing.localhost',
          'x-forwarded-method': 'GET',
          'x-forwarded-uri': '/dashboard',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers[compartmentAccessModeResponseHeaderName]).toBe('public');
      expect(response.headers[compartmentOrganizationIdResponseHeaderName]).toBe('org_123');
      expect(response.headers[compartmentOrganizationSlugResponseHeaderName]).toBe('acme-dev');
      expect(response.headers[compartmentPrincipalEmailResponseHeaderName]).toBeUndefined();
      expect(response.headers[compartmentPrincipalIdResponseHeaderName]).toBeUndefined();
      expect(response.headers[compartmentPrincipalTypeResponseHeaderName]).toBeUndefined();
      expect(response.headers[compartmentUpstreamHostResponseHeaderName]).toBe('127.0.0.1');
      expect(response.headers[compartmentUpstreamPortResponseHeaderName]).toBe('31042');
    } finally {
      await app.close();
    }
  });

  it('clears stale app-session cookies before redirecting to login', async (): Promise<void> => {
    const { app } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot(),
    });

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: compartmentIngressAuthorizePathname,
        headers: {
          cookie: readAppSessionCookie('missing-session'),
          host: 'billing.localhost',
          'x-forwarded-method': 'GET',
          'x-forwarded-uri': '/dashboard',
        },
      });

      expect(response.statusCode).toBe(302);
      expect(String(response.headers['set-cookie'])).toContain(`${compartmentAppSessionCookieName}=;`);
      expect(String(response.headers['set-cookie'])).toContain('Secure');
      expect(String(response.headers['set-cookie'])).not.toContain('Domain=');
      const loginFlowState: string = new URL(response.headers.location ?? '').searchParams.get('state') ?? '';
      expect(
        requireSetCookieValue(response.headers['set-cookie'], readCompartmentAppFlowCookieName(loginFlowState)),
      ).toBe('1');
    } finally {
      await app.close();
    }
  });

  it('keeps the login flow cookie secure and host-only on https redirects', async (): Promise<void> => {
    const { app } = createEdgeTestApp({
      config: {
        publicProtocol: 'https',
      },
      snapshot: createAppAccessSnapshot(),
    });

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: compartmentIngressAuthorizePathname,
        headers: {
          host: 'billing.localhost',
          'x-forwarded-method': 'GET',
          'x-forwarded-uri': '/dashboard',
        },
      });
      const loginFlowState: string = new URL(response.headers.location ?? '').searchParams.get('state') ?? '';
      const flowCookieHeader: string = requireSetCookieHeader(
        response.headers['set-cookie'],
        readCompartmentAppFlowCookieName(loginFlowState),
      );

      expect(response.statusCode).toBe(302);
      expect(flowCookieHeader).toContain('Secure');
      expect(flowCookieHeader).not.toContain('Domain=');
    } finally {
      await app.close();
    }
  });

  it('returns 403 when the session principal no longer has route access', async (): Promise<void> => {
    const { app } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot({
        grants: [],
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
          'x-forwarded-uri': '/dashboard',
        },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: 'forbidden' });
    } finally {
      await app.close();
    }
  });

  it('returns trusted compartment headers and route port for authorized app requests', async (): Promise<void> => {
    const { app } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot({
        upstreamPort: 31042,
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
          'x-forwarded-uri': '/dashboard?tab=activity',
          [compartmentPrincipalIdResponseHeaderName]: 'spoofed',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers[compartmentAccessModeResponseHeaderName]).toBe('authenticated');
      expect(response.headers[compartmentOrganizationIdResponseHeaderName]).toBe('org_123');
      expect(response.headers[compartmentOrganizationSlugResponseHeaderName]).toBe('acme-dev');
      expect(response.headers[compartmentPrincipalEmailResponseHeaderName]).toBe('admin@example.com');
      expect(response.headers[compartmentPrincipalIdResponseHeaderName]).toBe('prn_123');
      expect(response.headers[compartmentPrincipalTypeResponseHeaderName]).toBe('user');
      expect(response.headers[compartmentUpstreamHostResponseHeaderName]).toBe('127.0.0.1');
      expect(response.headers[compartmentUpstreamPortResponseHeaderName]).toBe('31042');
    } finally {
      await app.close();
    }
  });

  it('ignores legacy app session cookies when a host-bound app session is present', async (): Promise<void> => {
    const { app } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot({
        grants: [
          {
            permissions: ['app.route.access'],
            principalId: 'prn_attacker',
            scopeId: 'org_123',
            scopeType: 'organization',
          },
          {
            permissions: ['app.route.access'],
            principalId: 'prn_victim',
            scopeId: 'org_123',
            scopeType: 'organization',
          },
        ],
        upstreamPort: 31042,
      }),
      sessions: [
        {
          session: {
            ...createAppSessionState({
              host: 'billing.localhost',
            }),
            principalEmail: 'attacker@example.com',
            principalId: 'prn_attacker',
          },
          token: 'attacker-session-token',
        },
        {
          session: {
            ...createAppSessionState({
              host: 'billing.localhost',
            }),
            principalEmail: 'victim@example.com',
            principalId: 'prn_victim',
          },
          token: 'victim-session-token',
        },
      ],
    });

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: compartmentIngressAuthorizePathname,
        headers: {
          cookie:
            `${legacyCompartmentAppSessionCookieName}=attacker-session-token; ` +
            readAppSessionCookie('victim-session-token'),
          host: 'billing.localhost',
          'x-forwarded-method': 'GET',
          'x-forwarded-uri': '/dashboard?tab=activity',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers[compartmentPrincipalEmailResponseHeaderName]).toBe('victim@example.com');
      expect(response.headers[compartmentPrincipalIdResponseHeaderName]).toBe('prn_victim');
    } finally {
      await app.close();
    }
  });

  it('does not accept legacy app session cookies by themselves', async (): Promise<void> => {
    const { app } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot(),
      sessions: [
        {
          session: createAppSessionState(),
          token: 'legacy-session-token',
        },
      ],
    });

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: compartmentIngressAuthorizePathname,
        headers: {
          cookie: `${legacyCompartmentAppSessionCookieName}=legacy-session-token`,
          host: 'billing.localhost',
          'x-forwarded-method': 'GET',
          'x-forwarded-uri': '/dashboard',
        },
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers[compartmentPrincipalEmailResponseHeaderName]).toBeUndefined();
      expect(String(response.headers['set-cookie'])).not.toContain(`${compartmentAppSessionCookieName}=;`);
    } finally {
      await app.close();
    }
  });

  it('returns trusted compartment headers for authorized custom-host app requests', async (): Promise<void> => {
    const { app } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot({
        host: 'app.customer.example.com',
        upstreamPort: 31042,
      }),
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
        method: 'GET',
        url: compartmentIngressAuthorizePathname,
        headers: {
          cookie: readAppSessionCookie('app-session-token'),
          host: 'app.customer.example.com',
          'x-forwarded-method': 'GET',
          'x-forwarded-uri': '/dashboard?tab=activity',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers[compartmentPrincipalIdResponseHeaderName]).toBe('prn_123');
      expect(response.headers[compartmentUpstreamPortResponseHeaderName]).toBe('31042');
    } finally {
      await app.close();
    }
  });

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
          'x-forwarded-method': 'GET',
          'x-forwarded-uri': '/api/ready?via=browser',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers[compartmentUpstreamHostResponseHeaderName]).toBe('127.0.0.1');
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

  it('returns 403 when source access is granted but the matched target route is denied', async (): Promise<void> => {
    const { app } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot({
        grants: [
          {
            permissions: ['app.route.access'],
            principalId: 'prn_123',
            scopeId: 'org_123',
            scopeType: 'organization',
          },
          {
            permissions: ['project.read'],
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
          'x-forwarded-method': 'GET',
          'x-forwarded-uri': '/api/ready',
        },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: 'forbidden' });
      expect(response.headers[compartmentUpstreamPortResponseHeaderName]).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('returns 404 for ambiguous dot-segment proxy paths instead of falling back to the source route', async (): Promise<void> => {
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
          'x-forwarded-method': 'GET',
          'x-forwarded-uri': '/api/%2e%2e/healthz',
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'route_not_found' });
      expect(response.headers.location).toBeUndefined();
      expect(response.headers[compartmentUpstreamHostResponseHeaderName]).toBeUndefined();
      expect(response.headers[compartmentUpstreamPortResponseHeaderName]).toBeUndefined();
      expect(response.headers[compartmentProxyPathResponseHeaderName]).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('returns 404 for encoded path separators before proxy matching', async (): Promise<void> => {
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
          'x-forwarded-method': 'GET',
          'x-forwarded-uri': '/api/%2Fhealthz',
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'route_not_found' });
      expect(response.headers[compartmentUpstreamHostResponseHeaderName]).toBeUndefined();
      expect(response.headers[compartmentUpstreamPortResponseHeaderName]).toBeUndefined();
      expect(response.headers[compartmentProxyPathResponseHeaderName]).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('returns replacePrefix proxy headers when a method-scoped route matches', async (): Promise<void> => {
    const { app } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot({
        proxyRoutes: [
          {
            methods: ['POST'],
            on: 'web',
            path: '/api/*',
            replacePrefix: '/internal',
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
          'x-forwarded-method': 'POST',
          'x-forwarded-uri': '/api/users?via=browser',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers[compartmentUpstreamHostResponseHeaderName]).toBe('127.0.0.1');
      expect(response.headers[compartmentUpstreamPortResponseHeaderName]).toBe('31042');
      expect(response.headers[compartmentProxyPathResponseHeaderName]).toBe('/internal/users?via=browser');
    } finally {
      await app.close();
    }
  });

  it('falls through to the source route when a method-scoped proxy rule does not match', async (): Promise<void> => {
    const { app } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot({
        proxyRoutes: [
          {
            methods: ['POST'],
            on: 'web',
            path: '/api/*',
            replacePrefix: '/internal',
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
          'x-forwarded-method': 'GET',
          'x-forwarded-uri': '/api/users?via=browser',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers[compartmentUpstreamHostResponseHeaderName]).toBe('127.0.0.1');
      expect(response.headers[compartmentUpstreamPortResponseHeaderName]).toBe('31000');
      expect(response.headers[compartmentProxyPathResponseHeaderName]).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('returns exact rewrite proxy headers for matched exact-path rules', async (): Promise<void> => {
    const { app } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot({
        proxyRoutes: [
          {
            on: 'web',
            path: '/health',
            rewrite: '/ready',
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
          'x-forwarded-method': 'GET',
          'x-forwarded-uri': '/health?deep=1',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers[compartmentUpstreamHostResponseHeaderName]).toBe('127.0.0.1');
      expect(response.headers[compartmentUpstreamPortResponseHeaderName]).toBe('31042');
      expect(response.headers[compartmentProxyPathResponseHeaderName]).toBe('/ready?deep=1');
    } finally {
      await app.close();
    }
  });

  it('authorizes hosted-app access from permission grants', async (): Promise<void> => {
    const { app } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot({
        grants: [
          {
            principalId: 'prn_123',
            permissions: ['project.read', 'app.route.access'],
            scopeId: 'org_123',
            scopeType: 'organization',
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
          'x-forwarded-uri': '/dashboard',
        },
      });

      expect(response.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('authorizes hosted-app access from project and environment scoped grants', async (): Promise<void> => {
    const { app } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot({
        grants: [
          {
            permissions: ['app.route.access'],
            principalId: 'prn_123',
            scopeId: 'prj_123',
            scopeType: 'project',
          },
        ],
        routeScopeId: 'env_123',
        routeScopeType: 'environment',
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
          'x-forwarded-method': 'GET',
          'x-forwarded-uri': '/dashboard',
        },
      });

      expect(response.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('prefers a narrower environment grant over a broader organization grant', async (): Promise<void> => {
    const { app } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot({
        grants: [
          {
            permissions: ['project.read'],
            principalId: 'prn_123',
            scopeId: 'env_123',
            scopeType: 'environment',
          },
          {
            permissions: ['app.route.access'],
            principalId: 'prn_123',
            scopeId: 'org_123',
            scopeType: 'organization',
          },
        ],
        routeScopeId: 'env_123',
        routeScopeType: 'environment',
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
          'x-forwarded-method': 'GET',
          'x-forwarded-uri': '/dashboard',
        },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: 'forbidden' });
    } finally {
      await app.close();
    }
  });

  it('denies a live app session after the grant snapshot is refreshed without that principal', async (): Promise<void> => {
    const { app, store } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot(),
      sessions: [{ session: createAppSessionState(), token: 'app-session-token' }],
    });

    store.replaceSnapshot(createAppAccessSnapshot({ grants: [] }));

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: compartmentIngressAuthorizePathname,
        headers: {
          cookie: readAppSessionCookie('app-session-token'),
          host: 'billing.localhost',
          'x-forwarded-method': 'GET',
          'x-forwarded-uri': '/dashboard',
        },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: 'forbidden' });
    } finally {
      await app.close();
    }
  });
});

function readAppSessionCookie(sessionToken: string): string {
  return `${appSessionCookiePrefix}${sessionToken}`;
}
