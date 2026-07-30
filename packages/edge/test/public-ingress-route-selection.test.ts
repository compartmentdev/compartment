import { compartmentIngressAuthorizePathname, compartmentIngressRouteResolvedHeaderName } from '@compartment/contracts';
import type { LightMyRequestResponse } from 'fastify';
import { describe, expect, it } from 'vitest';
import { createAppAccessSnapshot, createEdgeTestApp } from './edge-test.utils';

const resolvedSelectionHeaders: Record<string, string> = {
  [compartmentIngressRouteResolvedHeaderName]: '1',
  'x-compartment-upstream-host': 'app.cpt-project.svc',
  'x-compartment-upstream-port': '31000',
};

describe('edge ingress route selection', (): void => {
  it.each<[string, Record<string, string>]>([
    ['upstream host', { 'x-compartment-upstream-host': 'stale.cpt-project.svc' }],
    ['upstream port', { 'x-compartment-upstream-port': '31999' }],
    ['proxy path', { 'x-compartment-proxy-path': '/stale' }],
    ['resolution marker', { [compartmentIngressRouteResolvedHeaderName]: 'invalid' }],
  ])(
    'rejects an allowed request when the resolved %s changes',
    async (_name: string, changedHeaders: Record<string, string>): Promise<void> => {
      const { app } = createEdgeTestApp({
        snapshot: createAppAccessSnapshot({
          accessMode: 'public',
        }),
      });

      try {
        const response: LightMyRequestResponse = await app.inject({
          method: 'GET',
          url: compartmentIngressAuthorizePathname,
          headers: {
            ...resolvedSelectionHeaders,
            ...changedHeaders,
            host: 'billing.localhost',
            'x-forwarded-method': 'GET',
            'x-forwarded-uri': '/dashboard',
          },
        });

        expect(response.statusCode).toBe(503);
        expect(response.json()).toEqual({ error: 'unavailable' });
      } finally {
        await app.close();
      }
    },
  );

  it('accepts headerless authorization from legacy Caddy during a mixed-version rollout', async (): Promise<void> => {
    const { app } = createEdgeTestApp({
      snapshot: createAppAccessSnapshot({
        accessMode: 'public',
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
    } finally {
      await app.close();
    }
  });
});
