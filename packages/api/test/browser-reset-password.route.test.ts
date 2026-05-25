import { compartmentCsrfCookieName } from '@compartment/contracts';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ApiApp } from '../src/app.types';
import { browserResetPasswordPathname } from '../src/browser-public-paths';
import type { hasCompletedInstallation } from '../src/queries/install.query';
import { browserPageRateLimitRouteOptions } from '../src/routes/browser/browser-page-rate-limit.route';
import type { createBrowserAuthTokenFlowPlan } from '../src/services/browser-auth-token-flow.service';
import type { readPasswordResetTokenExpiresAt } from '../src/services/password-reset-token-expiration.service';
import { applyApiRouteTestEnv, injectApiRoute, withApiRouteApp } from './api-route-test.harness';
import { expectNoStoreCacheControlHeader } from './response-cache-test.helpers';

type CreateBrowserAuthTokenFlowPlan = typeof createBrowserAuthTokenFlowPlan;
type HasCompletedInstallation = typeof hasCompletedInstallation;
type ReadPasswordResetTokenExpiresAt = typeof readPasswordResetTokenExpiresAt;

interface BrowserResetPasswordRouteMocks {
  createBrowserAuthTokenFlowPlan: Mock<CreateBrowserAuthTokenFlowPlan>;
  hasCompletedInstallation: Mock<HasCompletedInstallation>;
  readPasswordResetTokenExpiresAt: Mock<ReadPasswordResetTokenExpiresAt>;
}

interface BrowserAuthTokenFlowServiceMockModule {
  createBrowserAuthTokenFlowPlan: Mock<CreateBrowserAuthTokenFlowPlan>;
}

interface InstallQueryMockModule {
  hasCompletedInstallation: Mock<HasCompletedInstallation>;
}

interface PasswordResetServiceMockModule {
  readPasswordResetTokenExpiresAt: Mock<ReadPasswordResetTokenExpiresAt>;
}

const browserPageRateLimitMaxRequests: number = browserPageRateLimitRouteOptions.config.rateLimit.max;

const mocks: BrowserResetPasswordRouteMocks = vi.hoisted(
  (): BrowserResetPasswordRouteMocks => ({
    createBrowserAuthTokenFlowPlan: vi.fn<CreateBrowserAuthTokenFlowPlan>(),
    hasCompletedInstallation: vi.fn<HasCompletedInstallation>(),
    readPasswordResetTokenExpiresAt: vi.fn<ReadPasswordResetTokenExpiresAt>(),
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

vi.mock(
  '../src/services/password-reset-token-expiration.service',
  (): PasswordResetServiceMockModule => ({
    readPasswordResetTokenExpiresAt: mocks.readPasswordResetTokenExpiresAt,
  }),
);

describe('browser reset password route', (): void => {
  afterEach((): void => {
    mocks.createBrowserAuthTokenFlowPlan.mockReset();
    mocks.hasCompletedInstallation.mockReset();
    mocks.readPasswordResetTokenExpiresAt.mockReset();
  });

  it('stores a query token in a server-side flow and redirects to a clean reset URL', async (): Promise<void> => {
    applyApiRouteTestEnv({
      baseDomain: 'example.com',
    });
    mocks.hasCompletedInstallation.mockResolvedValueOnce(true);
    mocks.readPasswordResetTokenExpiresAt.mockResolvedValueOnce(new Date('2029-01-01T00:00:00.000Z'));
    mocks.createBrowserAuthTokenFlowPlan.mockResolvedValueOnce({
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
      flowId: 'reset-flow-id',
    });
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        method: 'GET',
        query: {
          email: 'viewer@example.com',
          host: 'billing.localhost',
          path: '/dashboard',
          state: 'flow',
          token: 'reset-token',
        },
        url: browserResetPasswordPathname,
      });

      expect(response.statusCode).toBe(302);
      expectNoStoreCacheControlHeader(response);
      expect(response.headers.location).toBe(
        `${browserResetPasswordPathname}?email=viewer%40example.com&host=billing.localhost&path=%2Fdashboard&state=flow`,
      );
      expect(String(response.headers['set-cookie'])).toContain(
        '__Host-compartment_credential_reset_flow=reset-flow-id',
      );
      expect(String(response.headers['set-cookie'])).toContain('__Host-compartment_pwd_reset_token=;');
      expect(String(response.headers['set-cookie'])).not.toContain('reset-token');
    });
  });

  it('does not store invalid reset query tokens in a browser flow', async (): Promise<void> => {
    applyApiRouteTestEnv({
      baseDomain: 'example.com',
    });
    mocks.hasCompletedInstallation.mockResolvedValueOnce(true);
    mocks.readPasswordResetTokenExpiresAt.mockResolvedValueOnce(undefined);
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        method: 'GET',
        query: {
          email: 'viewer@example.com',
          token: 'invalid-reset-token',
        },
        url: browserResetPasswordPathname,
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe(`${browserResetPasswordPathname}?email=viewer%40example.com`);
      expect(String(response.headers['set-cookie'])).toContain('__Host-compartment_pwd_reset_token=;');
      expect(String(response.headers['set-cookie'])).toContain('__Host-compartment_credential_reset_flow=;');
      expect(String(response.headers['set-cookie'])).not.toContain('invalid-reset-token');
    });
  });

  it('renders the auth shell and creates a CSRF cookie for reset password', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.hasCompletedInstallation.mockResolvedValueOnce(true);
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        method: 'GET',
        url: browserResetPasswordPathname,
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain('<!doctype html>');
      expect(response.body).toContain('/browser-assets/auth.js');
      expect(response.body).toContain('/browser-assets/styles.css');
      expect(String(response.headers['set-cookie'])).toContain(`${compartmentCsrfCookieName}=`);
      expect(String(response.headers['set-cookie'])).toContain('__Host-compartment_pwd_reset_token=;');
      expectNoStoreCacheControlHeader(response);
    });
  });

  it('rate limits reset password shell requests', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.hasCompletedInstallation.mockResolvedValue(true);
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      for (let attempt: number = 0; attempt < browserPageRateLimitMaxRequests; attempt += 1) {
        const response: LightMyRequestResponse = await injectApiRoute(app, {
          method: 'GET',
          url: browserResetPasswordPathname,
        });

        expect(response.statusCode).toBe(200);
      }

      const limitedResponse: LightMyRequestResponse = await injectApiRoute(app, {
        method: 'GET',
        url: browserResetPasswordPathname,
      });

      expect(limitedResponse.statusCode).toBe(429);
    });
  });
});
