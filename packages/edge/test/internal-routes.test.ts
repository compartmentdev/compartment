import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppAccessStateResponse, EdgeInvalidateAppSessionsRequest } from '@compartment/contracts';
import { createAppAccessSnapshot, createAppSessionState, createEdgeTestApp } from './edge-test.utils';

afterEach((): void => {
  vi.unstubAllGlobals();
});

describe('edge internal routes', (): void => {
  it('exposes snapshot metrics only to authenticated internal callers', async (): Promise<void> => {
    const { app } = createEdgeTestApp();

    try {
      const unauthorized: LightMyRequestResponse = await app.inject({ method: 'GET', url: '/internal/metrics' });
      const authorized: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: '/internal/metrics',
        headers: { authorization: 'Bearer test-edge-token' },
      });

      expect(unauthorized.statusCode).toBe(401);
      expect(authorized.statusCode).toBe(200);
      expect(authorized.headers['content-type']).toContain('text/plain');
      expect(authorized.body).toContain('compartment_edge_snapshot_age_seconds');
    } finally {
      await app.close();
    }
  });

  it('rejects unauthenticated state updates', async (): Promise<void> => {
    const { app } = createEdgeTestApp();

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'PUT',
        url: '/internal/app-access/state',
        payload: {
          state: createAppAccessSnapshot(),
        } satisfies AppAccessStateResponse,
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'unauthorized' });
    } finally {
      await app.close();
    }
  });

  it('replaces state and revokes sessions for authenticated requests', async (): Promise<void> => {
    const { app, store } = createEdgeTestApp({
      sessions: [
        {
          session: createAppSessionState(),
          token: 'app-session-token',
        },
      ],
    });

    try {
      const replaceResponse: LightMyRequestResponse = await app.inject({
        method: 'PUT',
        url: '/internal/app-access/state',
        headers: {
          authorization: 'Bearer test-edge-token',
        },
        payload: {
          state: createAppAccessSnapshot({
            upstreamPort: 31001,
          }),
        } satisfies AppAccessStateResponse,
      });

      expect(replaceResponse.statusCode).toBe(204);
      expect(store.getRoute('billing.localhost')?.upstreamPort).toBe(31001);

      const revokeResponse: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: '/internal/app-access/sessions/revoke',
        headers: {
          authorization: 'Bearer test-edge-token',
        },
        payload: {
          authSessionId: 'auth_123',
        } satisfies EdgeInvalidateAppSessionsRequest,
      });

      expect(revokeResponse.statusCode).toBe(204);
      expect(store.getSession('app-session-token')).toBeNull();
    } finally {
      await app.close();
    }
  });

  it('clears the snapshot when the authenticated state payload is null', async (): Promise<void> => {
    const { app, store } = createEdgeTestApp({
      sessions: [
        {
          session: createAppSessionState(),
          token: 'app-session-token',
        },
      ],
      snapshot: createAppAccessSnapshot(),
    });

    try {
      const response: LightMyRequestResponse = await app.inject({
        method: 'PUT',
        url: '/internal/app-access/state',
        headers: {
          authorization: 'Bearer test-edge-token',
        },
        payload: {
          state: null,
        } satisfies AppAccessStateResponse,
      });

      expect(response.statusCode).toBe(204);
      expect(store.getCompartmentUrl()).toBeNull();
      expect(store.getRoute('billing.localhost')).toBeNull();
      expect(store.getSession('app-session-token')).toBeNull();
    } finally {
      await app.close();
    }
  });
});
