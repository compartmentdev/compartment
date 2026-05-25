import { compartmentIngressAuthorizePathname } from '@compartment/contracts';
import type { LightMyRequestResponse } from 'fastify';
import { describe, expect, it } from 'vitest';
import { createAppAccessSnapshot, createEdgeTestApp } from './edge-test.utils';

describe('edge public ingress Host authority handling', (): void => {
  it('rejects malformed Host authority values before authorization', async (): Promise<void> => {
    const { app } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot(),
    });

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: compartmentIngressAuthorizePathname,
        headers: {
          host: 'billing.localhost:evil',
          'x-forwarded-uri': '/dashboard',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'invalid_host_header' });
      expect(response.headers.location).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('rejects encoded Host authority aliases before authorization', async (): Promise<void> => {
    const { app } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot(),
    });

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: compartmentIngressAuthorizePathname,
        headers: {
          host: 'billing%2elocalhost',
          'x-forwarded-uri': '/dashboard',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'invalid_host_header' });
      expect(response.headers.location).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('accepts Host authority values with numeric ports', async (): Promise<void> => {
    const { app } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot(),
    });

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: compartmentIngressAuthorizePathname,
        headers: {
          host: 'billing.localhost:443',
          'x-forwarded-uri': '/dashboard',
        },
      });

      expect(response.statusCode).toBe(302);
      expect(new URL(response.headers.location ?? '').searchParams.get('host')).toBe('billing.localhost');
    } finally {
      await app.close();
    }
  });
});
