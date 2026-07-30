import {
  compartmentAppCallbackPathname,
  compartmentIngressRoutePathname,
  compartmentIngressRouteResolvedHeaderName,
  compartmentProxyPathHeaderName,
  compartmentUpstreamHostHeaderName,
  compartmentUpstreamPortHeaderName,
} from '@compartment/contracts';
import type { LightMyRequestResponse } from 'fastify';
import { describe, expect, it } from 'vitest';
import { createAppAccessProxyRouteTargetState, createAppAccessSnapshot, createEdgeTestApp } from './edge-test.utils';

const proxyPathHeaderName: string = compartmentProxyPathHeaderName.toLowerCase();
const routeResolvedHeaderName: string = compartmentIngressRouteResolvedHeaderName.toLowerCase();
const upstreamHostHeaderName: string = compartmentUpstreamHostHeaderName.toLowerCase();
const upstreamPortHeaderName: string = compartmentUpstreamPortHeaderName.toLowerCase();

describe('edge ingress route resolution', (): void => {
  it('returns trusted upstream attribution before app access authorization', async (): Promise<void> => {
    const { app } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot(),
    });

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: compartmentIngressRoutePathname,
        headers: {
          host: 'billing.localhost',
          'x-forwarded-method': 'GET',
          'x-forwarded-uri': '/dashboard',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers[routeResolvedHeaderName]).toBe('1');
      expect(response.headers[upstreamHostHeaderName]).toBe('app.cpt-project.svc');
      expect(response.headers[upstreamPortHeaderName]).toBe('31000');
      expect(response.headers[proxyPathHeaderName]).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('returns no attribution for an unknown hosted application', async (): Promise<void> => {
    const { app } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot(),
    });

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: compartmentIngressRoutePathname,
        headers: {
          host: 'unknown.localhost',
          'x-forwarded-method': 'GET',
          'x-forwarded-uri': '/dashboard',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers[routeResolvedHeaderName]).toBe('1');
      expect(response.headers[upstreamHostHeaderName]).toBeUndefined();
      expect(response.headers[upstreamPortHeaderName]).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('attributes a matched proxy route to its target workload', async (): Promise<void> => {
    const { app } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot({
        proxyRoutes: [
          {
            on: 'web',
            path: '/admin/*',
            stripPrefix: '/admin',
            target: createAppAccessProxyRouteTargetState({
              upstreamHost: 'admin.cpt-project.svc',
              upstreamPort: 32000,
            }),
            to: 'admin',
          },
        ],
      }),
    });

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: compartmentIngressRoutePathname,
        headers: {
          host: 'billing.localhost',
          'x-forwarded-method': 'GET',
          'x-forwarded-uri': '/admin/users',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers[upstreamHostHeaderName]).toBe('admin.cpt-project.svc');
      expect(response.headers[upstreamPortHeaderName]).toBe('32000');
      expect(response.headers[proxyPathHeaderName]).toBe('/users');
    } finally {
      await app.close();
    }
  });

  it('attributes edge-owned app flow paths to the hosted application instead of a wildcard proxy target', async (): Promise<void> => {
    const { app } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot({
        proxyRoutes: [
          {
            on: 'web',
            path: '/_compartment/*',
            target: createAppAccessProxyRouteTargetState({
              upstreamHost: 'admin.cpt-project.svc',
              upstreamPort: 32000,
            }),
            to: 'admin',
          },
        ],
      }),
    });

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: compartmentIngressRoutePathname,
        headers: {
          host: 'billing.localhost',
          'x-forwarded-method': 'GET',
          'x-forwarded-uri': compartmentAppCallbackPathname,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers[upstreamHostHeaderName]).toBe('app.cpt-project.svc');
      expect(response.headers[upstreamPortHeaderName]).toBe('31000');
      expect(response.headers[proxyPathHeaderName]).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('returns no attribution for a matched proxy route without an active target', async (): Promise<void> => {
    const { app } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot({
        proxyRoutes: [
          {
            on: 'web',
            path: '/admin/*',
            target: createAppAccessProxyRouteTargetState({
              upstreamHost: null,
              upstreamPort: null,
            }),
            to: 'admin',
          },
        ],
      }),
    });

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: compartmentIngressRoutePathname,
        headers: {
          host: 'billing.localhost',
          'x-forwarded-method': 'GET',
          'x-forwarded-uri': '/admin/users',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers[upstreamHostHeaderName]).toBeUndefined();
      expect(response.headers[upstreamPortHeaderName]).toBeUndefined();
      expect(response.headers[proxyPathHeaderName]).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});
