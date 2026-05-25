import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ApiApp } from '../src/app.types';
import { authApiActivateStatePathname, authApiResetPasswordStatePathname } from '../src/routes/auth/auth-api-paths';
import { authRateLimitRouteOptions } from '../src/routes/auth/auth-rate-limit.route';
import type { readActivationUnavailableReason } from '../src/services/activation.service';
import type { authenticateBrowserCompartmentSession } from '../src/services/app-access.service';
import type { requireInstalledCompartment } from '../src/services/app-access-target.service';
import type { readBrowserAuthTokenFlowToken } from '../src/services/browser-auth-token-flow.service';
import { applyApiRouteTestEnv, expectJsonError, injectApiRoute, withApiRouteApp } from './api-route-test.harness';
import { createBrowserCompartmentSession } from './browser-test.fixtures';
import { expectNoStoreCacheControlHeader } from './response-cache-test.helpers';

type AuthenticateBrowserCompartmentSession = typeof authenticateBrowserCompartmentSession;
type ReadActivationUnavailableReason = typeof readActivationUnavailableReason;
type ReadBrowserAuthTokenFlowToken = typeof readBrowserAuthTokenFlowToken;
type RequireInstalledCompartment = typeof requireInstalledCompartment;

interface ApiAuthTokenStateRouteMocks {
  authenticateBrowserCompartmentSession: Mock<AuthenticateBrowserCompartmentSession>;
  readActivationUnavailableReason: Mock<ReadActivationUnavailableReason>;
  readBrowserAuthTokenFlowToken: Mock<ReadBrowserAuthTokenFlowToken>;
  requireInstalledCompartment: Mock<RequireInstalledCompartment>;
}

const authApiTokenStateRouteBudget: number = authRateLimitRouteOptions.config.rateLimit.max;

const authApiActivateStateViewerQuery: Record<string, string> = {
  email: 'viewer@example.com',
};

const authApiResetPasswordStateViewerQuery: Record<string, string> = {
  email: 'viewer@example.com',
};

const mocks: ApiAuthTokenStateRouteMocks = vi.hoisted(
  (): ApiAuthTokenStateRouteMocks => ({
    authenticateBrowserCompartmentSession: vi.fn<AuthenticateBrowserCompartmentSession>(),
    readActivationUnavailableReason: vi.fn<ReadActivationUnavailableReason>(),
    readBrowserAuthTokenFlowToken: vi.fn<ReadBrowserAuthTokenFlowToken>(),
    requireInstalledCompartment: vi.fn<RequireInstalledCompartment>(),
  }),
);

vi.mock(
  '../src/services/activation.service',
  (): { readActivationUnavailableReason: Mock<ReadActivationUnavailableReason> } => ({
    readActivationUnavailableReason: mocks.readActivationUnavailableReason,
  }),
);

vi.mock(
  '../src/services/app-access.service',
  (): { authenticateBrowserCompartmentSession: Mock<AuthenticateBrowserCompartmentSession> } => ({
    authenticateBrowserCompartmentSession: mocks.authenticateBrowserCompartmentSession,
  }),
);

vi.mock(
  '../src/services/app-access-target.service',
  (): { requireInstalledCompartment: Mock<RequireInstalledCompartment> } => ({
    requireInstalledCompartment: mocks.requireInstalledCompartment,
  }),
);

vi.mock(
  '../src/services/browser-auth-token-flow.service',
  (): {
    readBrowserAuthTokenFlowToken: Mock<ReadBrowserAuthTokenFlowToken>;
  } => ({ readBrowserAuthTokenFlowToken: mocks.readBrowserAuthTokenFlowToken }),
);

describe('api auth token state routes', (): void => {
  afterEach((): void => {
    Object.values(mocks).forEach((mock: Mock): void => {
      mock.mockReset();
    });
  });

  it('returns activation state from query fields and the activation cookie', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.authenticateBrowserCompartmentSession.mockResolvedValueOnce(null);
    mocks.readBrowserAuthTokenFlowToken.mockResolvedValueOnce('bootstrap-token');

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        headers: {
          cookie: '__Host-compartment_activate_flow=activation-flow',
        },
        method: 'GET',
        query: authApiActivateStateViewerQuery,
        url: authApiActivateStatePathname,
      });

      expect(response.statusCode).toBe(200);
      expectNoStoreCacheControlHeader(response);
      expect(response.json()).toEqual({
        email: 'viewer@example.com',
        flowTarget: null,
        hasToken: true,
      });
      expect(mocks.readBrowserAuthTokenFlowToken).toHaveBeenCalledWith('activation', 'activation-flow');
    });
  });

  it('returns an activation unavailable state when the token cannot create local credentials', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.authenticateBrowserCompartmentSession.mockResolvedValueOnce(createBrowserCompartmentSession());
    mocks.readBrowserAuthTokenFlowToken.mockResolvedValueOnce('bootstrap-token');
    mocks.readActivationUnavailableReason.mockResolvedValueOnce('local_password_disabled');

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        headers: {
          cookie: '__Host-compartment_activate_flow=activation-flow',
        },
        method: 'GET',
        query: authApiActivateStateViewerQuery,
        url: authApiActivateStatePathname,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        email: 'viewer@example.com',
        flowTarget: null,
        hasToken: true,
        principalEmail: 'admin@example.com',
        unavailableReason: 'local_password_disabled',
      });
      expect(mocks.readActivationUnavailableReason).toHaveBeenCalledWith('bootstrap-token', 'viewer@example.com');
    });
  });

  it('returns reset password state from query fields and the reset cookie', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.authenticateBrowserCompartmentSession.mockResolvedValueOnce(createBrowserCompartmentSession());
    mocks.readBrowserAuthTokenFlowToken.mockResolvedValueOnce('reset-token');

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        headers: {
          cookie: '__Host-compartment_credential_reset_flow=reset-flow',
        },
        method: 'GET',
        query: authApiResetPasswordStateViewerQuery,
        url: authApiResetPasswordStatePathname,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        email: 'viewer@example.com',
        flowTarget: null,
        hasToken: true,
        principalEmail: 'admin@example.com',
      });
      expect(mocks.readBrowserAuthTokenFlowToken).toHaveBeenCalledWith('password_reset', 'reset-flow');
    });
  });

  it('rate limits repeated v1 auth activation state requests', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.authenticateBrowserCompartmentSession.mockResolvedValue(null);

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      for (let attempt: number = 0; attempt < authApiTokenStateRouteBudget; attempt += 1) {
        const response: LightMyRequestResponse = await injectApiRoute(app, {
          method: 'GET',
          query: authApiActivateStateViewerQuery,
          url: authApiActivateStatePathname,
        });

        expect(response.statusCode).toBe(200);
      }

      const limitedResponse: LightMyRequestResponse = await injectApiRoute(app, {
        method: 'GET',
        query: authApiActivateStateViewerQuery,
        url: authApiActivateStatePathname,
      });

      expectJsonError(limitedResponse, 429, 'api_rate_limit_exceeded');
      expect(mocks.authenticateBrowserCompartmentSession).toHaveBeenCalledTimes(authApiTokenStateRouteBudget);
    });
  });

  it('rate limits repeated v1 auth reset password state requests', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.authenticateBrowserCompartmentSession.mockResolvedValue(null);

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      for (let attempt: number = 0; attempt < authApiTokenStateRouteBudget; attempt += 1) {
        const response: LightMyRequestResponse = await injectApiRoute(app, {
          method: 'GET',
          query: authApiResetPasswordStateViewerQuery,
          url: authApiResetPasswordStatePathname,
        });

        expect(response.statusCode).toBe(200);
      }

      const limitedResponse: LightMyRequestResponse = await injectApiRoute(app, {
        method: 'GET',
        query: authApiResetPasswordStateViewerQuery,
        url: authApiResetPasswordStatePathname,
      });

      expectJsonError(limitedResponse, 429, 'api_rate_limit_exceeded');
      expect(mocks.authenticateBrowserCompartmentSession).toHaveBeenCalledTimes(authApiTokenStateRouteBudget);
    });
  });
});
