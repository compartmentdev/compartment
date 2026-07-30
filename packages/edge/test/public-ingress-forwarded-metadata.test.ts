import {
  compartmentAppSessionCookieName,
  compartmentIngressAuthorizePathname,
  compartmentProxyPathHeaderName,
  compartmentUpstreamHostHeaderName,
  compartmentUpstreamPortHeaderName,
} from '@compartment/contracts';
import {
  request as sendHttpRequest,
  type ClientRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyReply, FastifyRequest, HookHandlerDoneFunction, LightMyRequestResponse } from 'fastify';
import { describe, expect, it } from 'vitest';
import type { EdgeApp } from '../src/app.types';
import {
  createAppAccessProxyRouteTargetState,
  createAppAccessSnapshot,
  createAppSessionState,
  createEdgeTestApp,
} from './edge-test.utils';

const appSessionCookiePrefix: string = `${compartmentAppSessionCookieName}=`;
const compartmentProxyPathResponseHeaderName: string = compartmentProxyPathHeaderName.toLowerCase();
const compartmentUpstreamHostResponseHeaderName: string = compartmentUpstreamHostHeaderName.toLowerCase();
const compartmentUpstreamPortResponseHeaderName: string = compartmentUpstreamPortHeaderName.toLowerCase();

interface RawIngressAuthorizeResponse {
  body: string;
  headers: IncomingHttpHeaders;
  statusCode: number;
}

describe('edge public ingress forwarded metadata', (): void => {
  it('returns 404 when forwarded URI metadata is missing before login redirect handling', async (): Promise<void> => {
    const { app } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot(),
    });

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: compartmentIngressAuthorizePathname,
        headers: {
          host: 'billing.localhost',
          'x-compartment-upstream-host': 'app.cpt-project.svc',
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'route_not_found' });
      expect(response.headers.location).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('returns 404 when forwarded method metadata is missing before login redirect handling', async (): Promise<void> => {
    const { app } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot(),
    });

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: compartmentIngressAuthorizePathname,
        headers: {
          host: 'billing.localhost',
          'x-compartment-upstream-host': 'app.cpt-project.svc',
          'x-forwarded-uri': '/dashboard',
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'route_not_found' });
      expect(response.headers.location).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('returns 404 for duplicate forwarded URI headers before login redirect handling', async (): Promise<void> => {
    const { app } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot(),
    });

    try {
      const response: RawIngressAuthorizeResponse = await requestIngressAuthorizeWithRawHeaders(app, [
        'Host',
        'billing.localhost',
        'x-forwarded-method',
        'GET',
        'x-forwarded-uri',
        '/dashboard',
        'X-Forwarded-Uri',
        '/admin',
      ]);

      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body)).toEqual({ error: 'route_not_found' });
      expect(response.headers.location).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('returns 404 for duplicate forwarded URI headers before proxy matching', async (): Promise<void> => {
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
      const response: RawIngressAuthorizeResponse = await requestIngressAuthorizeWithRawHeaders(app, [
        'Host',
        'billing.localhost',
        'Cookie',
        readAppSessionCookie('app-session-token'),
        'x-forwarded-method',
        'GET',
        'x-forwarded-uri',
        '/api/ready',
        'X-Forwarded-Uri',
        '/dashboard',
      ]);

      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body)).toEqual({ error: 'route_not_found' });
      expect(response.headers[compartmentUpstreamHostResponseHeaderName]).toBeUndefined();
      expect(response.headers[compartmentUpstreamPortResponseHeaderName]).toBeUndefined();
      expect(response.headers[compartmentProxyPathResponseHeaderName]).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('returns 404 for comma-coalesced forwarded URI values before login redirect handling', async (): Promise<void> => {
    const { app } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot(),
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
          'x-forwarded-uri': '/dashboard,/admin',
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'route_not_found' });
      expect(response.headers.location).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('allows safe forwarded URI values with commas', async (): Promise<void> => {
    const { app } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot({
        proxyRoutes: [
          {
            on: 'web',
            path: '/assets/*',
            stripPrefix: '/assets',
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
          'x-compartment-proxy-path': '/app,v1.js?tag=a,b',
          'x-forwarded-method': 'GET',
          'x-forwarded-uri': '/assets/app,v1.js?tag=a,b',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers[compartmentProxyPathResponseHeaderName]).toBe('/app,v1.js?tag=a,b');
    } finally {
      await app.close();
    }
  });

  it('returns 404 for array-valued forwarded URI headers before login redirect handling', async (): Promise<void> => {
    const { app } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot(),
    });
    app.addHook('onRequest', (request: FastifyRequest, _reply: FastifyReply, done: HookHandlerDoneFunction): void => {
      request.headers['x-forwarded-uri'] = ['/dashboard'];
      done();
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
          'x-forwarded-uri': '/dashboard',
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'route_not_found' });
      expect(response.headers.location).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('returns 404 for duplicate forwarded method headers before proxy matching', async (): Promise<void> => {
    const { app } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot({
        proxyRoutes: [
          {
            methods: ['GET'],
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
      const response: RawIngressAuthorizeResponse = await requestIngressAuthorizeWithRawHeaders(app, [
        'Host',
        'billing.localhost',
        'Cookie',
        readAppSessionCookie('app-session-token'),
        'x-forwarded-method',
        'GET',
        'X-Forwarded-Method',
        'POST',
        'x-forwarded-uri',
        '/api/ready',
      ]);

      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body)).toEqual({ error: 'route_not_found' });
      expect(response.headers[compartmentUpstreamHostResponseHeaderName]).toBeUndefined();
      expect(response.headers[compartmentUpstreamPortResponseHeaderName]).toBeUndefined();
      expect(response.headers[compartmentProxyPathResponseHeaderName]).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('returns 404 for comma-coalesced forwarded method values before proxy matching', async (): Promise<void> => {
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
          'x-compartment-upstream-port': '31000',
          'x-forwarded-method': 'GET,POST',
          'x-forwarded-uri': '/api/ready',
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
});

async function requestIngressAuthorizeWithRawHeaders(
  app: EdgeApp,
  rawHeaders: string[],
): Promise<RawIngressAuthorizeResponse> {
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address: AddressInfo | string | null = app.server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected edge test app to listen on a TCP port.');
  }

  return await new Promise<RawIngressAuthorizeResponse>(
    (resolve: (response: RawIngressAuthorizeResponse) => void, reject: (error: Error) => void): void => {
      const request: ClientRequest = sendHttpRequest(
        {
          headers: rawHeaders,
          host: '127.0.0.1',
          method: 'GET',
          path: compartmentIngressAuthorizePathname,
          port: address.port,
        },
        (response: IncomingMessage): void => {
          let body: string = '';
          response.setEncoding('utf8');
          response.on('data', (chunk: string): void => {
            body += chunk;
          });
          response.on('end', (): void => {
            resolve({
              body,
              headers: response.headers,
              statusCode: response.statusCode ?? 0,
            });
          });
        },
      );

      request.on('error', reject);
      request.end();
    },
  );
}

function readAppSessionCookie(sessionToken: string): string {
  return `${appSessionCookiePrefix}${sessionToken}`;
}
