import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ApiApp } from '../src/app.types';
import type { readSystemDomainProbe } from '../src/services/system-domain-probe.service';
import { applyApiRouteTestEnv, injectApiRoute, withApiRouteApp } from './api-route-test.harness';

type ReadSystemDomainProbe = typeof readSystemDomainProbe;

interface SystemDomainProbeRouteMocks {
  readSystemDomainProbe: Mock<ReadSystemDomainProbe>;
}

const mocks: SystemDomainProbeRouteMocks = vi.hoisted(
  (): SystemDomainProbeRouteMocks => ({
    readSystemDomainProbe: vi.fn<ReadSystemDomainProbe>(),
  }),
);

vi.mock(
  '../src/services/system-domain-probe.service',
  (): {
    readSystemDomainProbe: Mock<ReadSystemDomainProbe>;
  } => ({
    readSystemDomainProbe: mocks.readSystemDomainProbe,
  }),
);

describe('system-domain probe route', (): void => {
  afterEach((): void => {
    mocks.readSystemDomainProbe.mockReset();
  });

  it('rejects malformed Host authority values', async (): Promise<void> => {
    prepareSystemDomainProbeRoute();

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        headers: {
          host: 'console.localhost:evil',
        },
        method: 'GET',
        url: '/_compartment/domain/probe/active',
      });

      expect(response.statusCode).toBe(400);
      expect(response.body).toContain('invalid_host_header');
    });
  });

  it('rejects encoded Host authority aliases', async (): Promise<void> => {
    prepareSystemDomainProbeRoute();

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        headers: {
          host: 'console%2elocalhost',
        },
        method: 'GET',
        url: '/_compartment/domain/probe/active',
      });

      expect(response.statusCode).toBe(400);
      expect(response.body).toContain('invalid_host_header');
    });
  });

  it('accepts Host authority values with numeric ports', async (): Promise<void> => {
    prepareSystemDomainProbeRoute();
    mocks.readSystemDomainProbe.mockResolvedValueOnce({ ok: true });

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        headers: {
          host: 'console.localhost:443',
        },
        method: 'GET',
        url: '/_compartment/domain/probe/active',
      });

      expect(response.statusCode).toBe(200);
    });
  });

  it('rejects missing Host authority values', async (): Promise<void> => {
    prepareSystemDomainProbeRoute();

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        headers: {
          host: ' ',
        },
        method: 'GET',
        url: '/_compartment/domain/probe/active',
      });

      expect(response.statusCode).toBe(400);
      expect(response.body).toContain('missing_host_header');
    });
  });
});

function prepareSystemDomainProbeRoute(): void {
  applyApiRouteTestEnv();
}
