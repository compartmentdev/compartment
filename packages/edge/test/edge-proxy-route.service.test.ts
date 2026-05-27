import { describe, expect, it } from 'vitest';
import type { AppAccessProxyRouteState, AppAccessProxyRouteTargetState } from '@compartment/contracts';
import {
  parseSafeForwardedRequestPath,
  type ParsedForwardedRequestPath,
} from '../src/services/edge-forwarded-request-path.service';
import { matchProxyRoute, type MatchedProxyRoute } from '../src/services/edge-proxy-route.service';

describe('edge proxy route service', (): void => {
  const proxyRouteTarget: AppAccessProxyRouteTargetState = createProxyRouteTarget();

  it('matches prefix routes and strips the configured prefix while preserving the query string', (): void => {
    const matchedRoute: MatchedProxyRoute | null = matchProxyRoute(
      [
        {
          on: 'web',
          path: '/api/*',
          stripPrefix: '/api',
          target: proxyRouteTarget,
          to: 'backoffice',
        },
      ],
      'GET',
      requireForwardedRequestPath('/api/ready?via=browser'),
    );

    expect(matchedRoute?.proxyPath).toBe('/ready?via=browser');
  });

  it('preserves safe raw path encodings when forwarding a matched proxy route', (): void => {
    const matchedRoute: MatchedProxyRoute | null = matchProxyRoute(
      [
        {
          on: 'web',
          path: '/api/*',
          stripPrefix: '/api',
          target: proxyRouteTarget,
          to: 'backoffice',
        },
      ],
      'GET',
      requireForwardedRequestPath('/api/releases%2ejson?via=browser'),
    );

    expect(matchedRoute?.proxyPath).toBe('/releases%2ejson?via=browser');
  });

  it('replaces the matched prefix when replacePrefix is configured', (): void => {
    const matchedRoute: MatchedProxyRoute | null = matchProxyRoute(
      [
        {
          on: 'web',
          path: '/api/*',
          replacePrefix: '/internal',
          target: proxyRouteTarget,
          to: 'backoffice',
        },
      ],
      'GET',
      requireForwardedRequestPath('/api/users'),
    );

    expect(matchedRoute?.proxyPath).toBe('/internal/users');
  });

  it('treats /* as a catch-all prefix and preserves rooted upstream paths', (): void => {
    const matchedRoute: MatchedProxyRoute | null = matchProxyRoute(
      [
        {
          on: 'web',
          path: '/*',
          stripPrefix: '/',
          target: proxyRouteTarget,
          to: 'backoffice',
        },
      ],
      'GET',
      requireForwardedRequestPath('/users?via=browser'),
    );

    expect(matchedRoute?.proxyPath).toBe('/users?via=browser');
  });

  it('rewrites exact-match routes to a fixed upstream path', (): void => {
    const matchedRoute: MatchedProxyRoute | null = matchProxyRoute(
      [
        {
          on: 'web',
          path: '/health',
          rewrite: '/ready',
          target: proxyRouteTarget,
          to: 'backoffice',
        },
      ],
      'GET',
      requireForwardedRequestPath('/health?deep=1'),
    );

    expect(matchedRoute?.proxyPath).toBe('/ready?deep=1');
  });

  it('applies method filters before first-match-wins route selection', (): void => {
    const proxyRoutes: AppAccessProxyRouteState[] = [
      {
        methods: ['GET'],
        on: 'web',
        path: '/api/*',
        stripPrefix: '/api',
        target: proxyRouteTarget,
        to: 'backoffice',
      },
      {
        on: 'web',
        path: '/api/*',
        rewrite: '/fallback',
        target: proxyRouteTarget,
        to: 'backoffice',
      },
    ];

    expect(matchProxyRoute(proxyRoutes, 'GET', requireForwardedRequestPath('/api/ready'))?.proxyPath).toBe('/ready');
    expect(matchProxyRoute(proxyRoutes, 'POST', requireForwardedRequestPath('/api/ready'))?.proxyPath).toBe(
      '/fallback',
    );
  });

  it.each([
    '/api/%2e%2e/healthz',
    '/api/%2E./healthz',
    '/api/../healthz',
    '/api/%2Fhealthz',
    '/api/%5Chealthz',
    '/api/\\healthz',
    '/api/ready,/api/admin',
  ])('rejects ambiguous forwarded path %s before route matching', (requestPath: string): void => {
    expect(parseSafeForwardedRequestPath(requestPath)).toBeNull();
  });
});

function requireForwardedRequestPath(requestPath: string): ParsedForwardedRequestPath {
  const forwardedRequestPath: ParsedForwardedRequestPath | null = parseSafeForwardedRequestPath(requestPath);
  if (forwardedRequestPath === null) {
    throw new Error(`Expected safe forwarded request path, got ${requestPath}.`);
  }

  return forwardedRequestPath;
}

function createProxyRouteTarget(): AppAccessProxyRouteTargetState {
  return {
    accessMode: 'authenticated',
    routeScopeId: 'org_123',
    routeScopeType: 'organization',
    scopeChain: [{ scopeId: 'org_123', scopeType: 'organization' }],
    upstreamHost: '127.0.0.1',
    upstreamPort: 31042,
  };
}
