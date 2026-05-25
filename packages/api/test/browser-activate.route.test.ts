import { compartmentCsrfCookieName } from '@compartment/contracts';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ApiApp } from '../src/app.types';
import { getBrowserAssetPathname } from '../src/browser-public-paths';
import type { hasCompletedInstallation } from '../src/queries/install.query';
import { browserPageRateLimitRouteOptions } from '../src/routes/browser/browser-page-rate-limit.route';
import type { readActivationTokenExpiresAt } from '../src/services/activation-token-expiration.service';
import type { createBrowserAuthTokenFlowPlan } from '../src/services/browser-auth-token-flow.service';
import { applyApiRouteTestEnv, expectJsonError, injectApiRoute, withApiRouteApp } from './api-route-test.harness';
import { expectBrowserAntiFramingHeaders } from './browser-route-security-test.helpers';
import { expectNoStoreCacheControlHeader } from './response-cache-test.helpers';

type CreateBrowserAuthTokenFlowPlan = typeof createBrowserAuthTokenFlowPlan;
type HasCompletedInstallation = typeof hasCompletedInstallation;
type ReadActivationTokenExpiresAt = typeof readActivationTokenExpiresAt;

interface BrowserActivateRouteMocks {
  createBrowserAuthTokenFlowPlan: Mock<CreateBrowserAuthTokenFlowPlan>;
  hasCompletedInstallation: Mock<HasCompletedInstallation>;
  readActivationTokenExpiresAt: Mock<ReadActivationTokenExpiresAt>;
}

interface BrowserAuthTokenFlowServiceMockModule {
  createBrowserAuthTokenFlowPlan: Mock<CreateBrowserAuthTokenFlowPlan>;
}

interface ActivationServiceMockModule {
  readActivationTokenExpiresAt: Mock<ReadActivationTokenExpiresAt>;
}

interface InstallQueryMockModule {
  hasCompletedInstallation: Mock<HasCompletedInstallation>;
}

const browserPageRateLimitMaxRequests: number = browserPageRateLimitRouteOptions.config.rateLimit.max;

const mocks: BrowserActivateRouteMocks = vi.hoisted(
  (): BrowserActivateRouteMocks => ({
    createBrowserAuthTokenFlowPlan: vi.fn<CreateBrowserAuthTokenFlowPlan>(),
    hasCompletedInstallation: vi.fn<HasCompletedInstallation>(),
    readActivationTokenExpiresAt: vi.fn<ReadActivationTokenExpiresAt>(),
  }),
);

vi.mock(
  '../src/services/activation-token-expiration.service',
  (): ActivationServiceMockModule => ({
    readActivationTokenExpiresAt: mocks.readActivationTokenExpiresAt,
  }),
);

vi.mock(
  '../src/services/browser-auth-token-flow.service',
  (): BrowserAuthTokenFlowServiceMockModule => ({
    createBrowserAuthTokenFlowPlan: mocks.createBrowserAuthTokenFlowPlan,
  }),
);

vi.mock(
  '../src/queries/install.query',
  (): InstallQueryMockModule => ({
    hasCompletedInstallation: mocks.hasCompletedInstallation,
  }),
);

describe('browser activate route', (): void => {
  afterEach((): void => {
    mocks.createBrowserAuthTokenFlowPlan.mockReset();
    mocks.hasCompletedInstallation.mockReset();
    mocks.readActivationTokenExpiresAt.mockReset();
  });

  it('stores a query token in a server-side flow and redirects to a clean activation URL', async (): Promise<void> => {
    applyApiRouteTestEnv({
      baseDomain: 'example.com',
    });
    mocks.hasCompletedInstallation.mockResolvedValueOnce(true);
    mocks.readActivationTokenExpiresAt.mockResolvedValueOnce(new Date('2029-01-01T00:00:00.000Z'));
    mocks.createBrowserAuthTokenFlowPlan.mockResolvedValueOnce({
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
      flowId: 'activation-flow-id',
    });
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        method: 'GET',
        query: {
          email: 'viewer@example.com',
          host: 'billing.localhost',
          path: '/dashboard',
          state: 'flow',
          token: 'bootstrap-token',
        },
        url: '/activate',
      });

      expect(response.statusCode).toBe(302);
      expectNoStoreCacheControlHeader(response);
      expect(response.headers.location).toBe(
        '/activate?email=viewer%40example.com&host=billing.localhost&path=%2Fdashboard&state=flow',
      );
      expect(String(response.headers['set-cookie'])).toContain('__Host-compartment_activate_flow=activation-flow-id');
      expect(String(response.headers['set-cookie'])).toContain('__Host-compartment_activate_token=;');
      expect(String(response.headers['set-cookie'])).not.toContain('bootstrap-token');
      expectBrowserAntiFramingHeaders(response);
    });
  });

  it('does not store invalid activation query tokens in a browser flow', async (): Promise<void> => {
    applyApiRouteTestEnv({
      baseDomain: 'example.com',
    });
    mocks.hasCompletedInstallation.mockResolvedValueOnce(true);
    mocks.readActivationTokenExpiresAt.mockResolvedValueOnce(undefined);
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        method: 'GET',
        query: {
          email: 'viewer@example.com',
          token: 'invalid-bootstrap-token',
        },
        url: '/activate',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe('/activate?email=viewer%40example.com');
      expect(String(response.headers['set-cookie'])).toContain('__Host-compartment_activate_token=;');
      expect(String(response.headers['set-cookie'])).toContain('__Host-compartment_activate_flow=;');
      expect(String(response.headers['set-cookie'])).not.toContain('invalid-bootstrap-token');
      expectBrowserAntiFramingHeaders(response);
    });
  });

  it('renders the auth shell and creates a CSRF cookie for activation', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.hasCompletedInstallation.mockResolvedValueOnce(true);
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        method: 'GET',
        url: '/activate',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain('<!doctype html>');
      expect(response.body).toContain(getBrowserAssetPathname('auth.js'));
      expect(response.body).toContain(getBrowserAssetPathname('styles.css'));
      expect(response.body).not.toContain('window.__COMPARTMENT_BROWSER_APP__');
      expect(String(response.headers['set-cookie'])).toContain(`${compartmentCsrfCookieName}=`);
      expect(String(response.headers['set-cookie'])).toContain('__Host-compartment_activate_token=;');
      expectNoStoreCacheControlHeader(response);
      expectBrowserAntiFramingHeaders(response);
    });
  });

  it('rejects activation requests with cookie-unsafe flow state', async (): Promise<void> => {
    applyApiRouteTestEnv({
      baseDomain: 'example.com',
    });
    mocks.hasCompletedInstallation.mockResolvedValueOnce(true);

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        method: 'GET',
        query: {
          email: 'viewer@example.com',
          host: 'billing.localhost',
          path: '/dashboard',
          state: 'flow/unsafe',
          token: 'bootstrap-token',
        },
        url: '/activate',
      });

      expectJsonError(response, 400, 'invalid_browser_activate_query');
      expect(mocks.createBrowserAuthTokenFlowPlan).not.toHaveBeenCalled();
    });
  });

  it('rate limits activation shell requests', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.hasCompletedInstallation.mockResolvedValue(true);
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      for (let attempt: number = 0; attempt < browserPageRateLimitMaxRequests; attempt += 1) {
        const response: LightMyRequestResponse = await injectApiRoute(app, {
          method: 'GET',
          url: '/activate',
        });

        expect(response.statusCode).toBe(200);
      }

      const limitedResponse: LightMyRequestResponse = await injectApiRoute(app, {
        method: 'GET',
        url: '/activate',
      });

      expect(limitedResponse.statusCode).toBe(429);
      expectBrowserAntiFramingHeaders(limitedResponse);
    });
  });
});
