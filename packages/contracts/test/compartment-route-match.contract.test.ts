import { describe, expect, it } from 'vitest';
import { matchCompartmentRoute, type CompartmentRouteMatch, type CompartmentRouteRule } from '../src';

describe('matchCompartmentRoute', (): void => {
  it('uses ordered first-match route semantics and preserves query strings', (): void => {
    const routes: CompartmentRouteRule[] = [
      {
        methods: ['POST'],
        on: 'web',
        path: '/api/*',
        stripPrefix: '/api',
        to: 'post-api',
      },
      {
        on: 'web',
        path: '/api/*',
        stripPrefix: '/api',
        to: 'api',
      },
    ];

    const match: CompartmentRouteMatch<CompartmentRouteRule> | null = matchCompartmentRoute(routes, 'GET', {
      pathname: '/api/users',
      search: '?active=true',
    });

    expect(match).toEqual({
      proxyPath: '/users?active=true',
      route: routes[1],
    });
  });

  it('applies prefix replacement and exact path matching', (): void => {
    const routes: CompartmentRouteRule[] = [
      {
        on: 'web',
        path: '/admin/*',
        replacePrefix: '/internal',
        to: 'backoffice',
      },
      {
        on: 'web',
        path: '/ready',
        rewrite: '/health',
        to: 'web',
      },
    ];

    expect(
      matchCompartmentRoute(routes, 'GET', {
        pathname: '/admin/users',
        search: '',
      }),
    ).toEqual({
      proxyPath: '/internal/users',
      route: routes[0],
    });
    expect(
      matchCompartmentRoute(routes, 'GET', {
        pathname: '/ready',
        search: '',
      }),
    ).toEqual({
      proxyPath: '/health',
      route: routes[1],
    });
  });
});
