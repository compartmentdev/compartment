import { compartmentCliLoginAttemptCookieName, compartmentSessionCookieName } from '@compartment/contracts';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ApiApp } from '../src/app.types';
import {
  browserLoginCliCompletedPathname,
  browserLoginCliPathname,
  getBrowserAssetPathname,
} from '../src/browser-public-paths';
import { createInvalidCliLoginError } from '../src/errors/api-business-error';
import {
  authApiCliExchangePathname,
  authApiCliStartPathname,
  authApiCliStatusPathname,
} from '../src/routes/auth/auth-api-paths';
import { browserNoReferrerPolicy } from '../src/routes/browser/browser-anti-framing.headers';
import type { requireInstalledCompartment } from '../src/services/app-access-target.service';
import type {
  failCliLoginAttempt,
  exchangeCliLogin,
  getCliLoginStatus,
  startCliBrowserLogin,
  startCliLogin,
} from '../src/services/cli-login.service';
import type {
  completeBrowserSsoLogin,
  findCliLoginAttemptIdForBrowserSsoCallback,
  startBrowserSsoLogin,
} from '../src/services/sso-oidc/sso-oidc-login.service';
import { applyApiRouteTestEnv, injectApiRoute, injectJson, withApiRouteApp } from './api-route-test.harness';
import { expectNoStoreCacheControlHeader } from './response-cache-test.helpers';

type CompleteBrowserSsoLogin = typeof completeBrowserSsoLogin;
type ExchangeCliLogin = typeof exchangeCliLogin;
type FailCliLoginAttempt = typeof failCliLoginAttempt;
type FindCliLoginAttemptIdForBrowserSsoCallback = typeof findCliLoginAttemptIdForBrowserSsoCallback;
type GetCliLoginStatus = typeof getCliLoginStatus;
type RequireInstalledCompartment = typeof requireInstalledCompartment;
type StartBrowserSsoLogin = typeof startBrowserSsoLogin;
type StartCliBrowserLogin = typeof startCliBrowserLogin;
type StartCliLogin = typeof startCliLogin;

interface CliLoginRouteMocks {
  completeBrowserSsoLogin: Mock<CompleteBrowserSsoLogin>;
  exchangeCliLogin: Mock<ExchangeCliLogin>;
  failCliLoginAttempt: Mock<FailCliLoginAttempt>;
  findCliLoginAttemptIdForBrowserSsoCallback: Mock<FindCliLoginAttemptIdForBrowserSsoCallback>;
  getCliLoginStatus: Mock<GetCliLoginStatus>;
  requireInstalledCompartment: Mock<RequireInstalledCompartment>;
  startBrowserSsoLogin: Mock<StartBrowserSsoLogin>;
  startCliBrowserLogin: Mock<StartCliBrowserLogin>;
  startCliLogin: Mock<StartCliLogin>;
}

const mocks: CliLoginRouteMocks = vi.hoisted(
  (): CliLoginRouteMocks => ({
    completeBrowserSsoLogin: vi.fn<CompleteBrowserSsoLogin>(),
    exchangeCliLogin: vi.fn<ExchangeCliLogin>(),
    failCliLoginAttempt: vi.fn<FailCliLoginAttempt>(),
    findCliLoginAttemptIdForBrowserSsoCallback: vi.fn<FindCliLoginAttemptIdForBrowserSsoCallback>(),
    getCliLoginStatus: vi.fn<GetCliLoginStatus>(),
    requireInstalledCompartment: vi.fn<RequireInstalledCompartment>(),
    startBrowserSsoLogin: vi.fn<StartBrowserSsoLogin>(),
    startCliBrowserLogin: vi.fn<StartCliBrowserLogin>(),
    startCliLogin: vi.fn<StartCliLogin>(),
  }),
);

vi.mock(
  '../src/services/app-access-target.service',
  (): { requireInstalledCompartment: Mock<RequireInstalledCompartment> } => ({
    requireInstalledCompartment: mocks.requireInstalledCompartment,
  }),
);

vi.mock(
  '../src/services/cli-login.service',
  (): {
    failCliLoginAttempt: Mock<FailCliLoginAttempt>;
    exchangeCliLogin: Mock<ExchangeCliLogin>;
    getCliLoginStatus: Mock<GetCliLoginStatus>;
    startCliBrowserLogin: Mock<StartCliBrowserLogin>;
    startCliLogin: Mock<StartCliLogin>;
  } => ({
    failCliLoginAttempt: mocks.failCliLoginAttempt,
    exchangeCliLogin: mocks.exchangeCliLogin,
    getCliLoginStatus: mocks.getCliLoginStatus,
    startCliBrowserLogin: mocks.startCliBrowserLogin,
    startCliLogin: mocks.startCliLogin,
  }),
);

vi.mock(
  '../src/services/sso-oidc/sso-oidc-login.service',
  (): {
    completeBrowserSsoLogin: Mock<CompleteBrowserSsoLogin>;
    findCliLoginAttemptIdForBrowserSsoCallback: Mock<FindCliLoginAttemptIdForBrowserSsoCallback>;
    startBrowserSsoLogin: Mock<StartBrowserSsoLogin>;
  } => ({
    completeBrowserSsoLogin: mocks.completeBrowserSsoLogin,
    findCliLoginAttemptIdForBrowserSsoCallback: mocks.findCliLoginAttemptIdForBrowserSsoCallback,
    startBrowserSsoLogin: mocks.startBrowserSsoLogin,
  }),
);

describe('CLI login routes', (): void => {
  beforeEach((): void => {
    applyApiRouteTestEnv();
    mocks.requireInstalledCompartment.mockResolvedValue();
  });

  afterEach((): void => {
    Object.values(mocks).forEach((mock: Mock): void => {
      mock.mockReset();
    });
  });

  it('returns the CLI login start payload', async (): Promise<void> => {
    mocks.startCliLogin.mockResolvedValueOnce({
      attemptId: 'cla_123',
      exchangeSecret: 'exchange-secret',
      expiresAt: new Date('2099-04-21T10:10:00.000Z'),
      pollAfterMs: 2000,
      verificationUrl: 'https://compartment.localhost/login/cli?attempt=cla_123#code=browser-code',
    });

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectJson(app, {
        method: 'POST',
        payload: {
          email: 'admin@example.com',
        },
        url: authApiCliStartPathname,
      });

      expect(response.statusCode).toBe(200);
      expectNoStoreCacheControlHeader(response);
      expect(response.json()).toEqual({
        attemptId: 'cla_123',
        exchangeSecret: 'exchange-secret',
        expiresAt: '2099-04-21T10:10:00.000Z',
        pollAfterMs: 2000,
        verificationUrl: 'https://compartment.localhost/login/cli?attempt=cla_123#code=browser-code',
      });
    });
  });

  it('accepts a CLI login start payload without an email hint', async (): Promise<void> => {
    mocks.startCliLogin.mockResolvedValueOnce({
      attemptId: 'cla_123',
      exchangeSecret: 'exchange-secret',
      expiresAt: new Date('2099-04-21T10:10:00.000Z'),
      pollAfterMs: 2000,
      verificationUrl: 'https://compartment.localhost/login/cli?attempt=cla_123#code=browser-code',
    });

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectJson(app, {
        method: 'POST',
        payload: {},
        url: authApiCliStartPathname,
      });

      expect(response.statusCode).toBe(200);
      expectNoStoreCacheControlHeader(response);
      expect(response.json()).toEqual({
        attemptId: 'cla_123',
        exchangeSecret: 'exchange-secret',
        expiresAt: '2099-04-21T10:10:00.000Z',
        pollAfterMs: 2000,
        verificationUrl: 'https://compartment.localhost/login/cli?attempt=cla_123#code=browser-code',
      });
      expect(mocks.startCliLogin).toHaveBeenCalledWith({});
    });
  });

  it('returns CLI login status and exchange payloads', async (): Promise<void> => {
    mocks.getCliLoginStatus.mockResolvedValueOnce({
      expiresAt: new Date('2099-04-21T10:10:00.000Z'),
      status: 'authenticated',
    });
    mocks.exchangeCliLogin.mockResolvedValueOnce({
      organizations: [{ id: 'org_123', name: 'Acme Dev', slug: 'acme-dev' }],
      principalEmail: 'admin@example.com',
      principalId: 'usr_123',
      sessionExpiresAt: new Date('2099-04-21T10:20:00.000Z'),
      sessionId: 'ses_123',
      sessionToken: 'session-token',
    });

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const statusResponse: LightMyRequestResponse = await injectJson(app, {
        method: 'POST',
        payload: {
          attemptId: 'cla_123',
          exchangeSecret: 'exchange-secret',
        },
        url: authApiCliStatusPathname,
      });
      const exchangeResponse: LightMyRequestResponse = await injectJson(app, {
        method: 'POST',
        payload: {
          attemptId: 'cla_123',
          exchangeSecret: 'exchange-secret',
        },
        url: authApiCliExchangePathname,
      });

      expect(statusResponse.statusCode).toBe(200);
      expectNoStoreCacheControlHeader(statusResponse);
      expect(statusResponse.json()).toEqual({
        expiresAt: '2099-04-21T10:10:00.000Z',
        status: 'authenticated',
      });
      expect(exchangeResponse.statusCode).toBe(200);
      expectNoStoreCacheControlHeader(exchangeResponse);
      expect(exchangeResponse.json()).toEqual({
        organizations: [{ id: 'org_123', name: 'Acme Dev', slug: 'acme-dev' }],
        principal: {
          email: 'admin@example.com',
          id: 'usr_123',
          type: 'user',
        },
        sessionToken: 'session-token',
      });
    });
  });

  it('serves the CLI login bootstrap page without leaking referrers', async (): Promise<void> => {
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        method: 'GET',
        query: { attempt: 'cla_123' },
        url: browserLoginCliPathname,
      });

      expect(response.statusCode).toBe(200);
      expectNoStoreCacheControlHeader(response);
      expect(response.headers['referrer-policy']).toBe(browserNoReferrerPolicy);
      expect(response.body).toContain(getBrowserAssetPathname('compartment-icon.svg'));
      expect(response.body).toContain('Starting CLI login');
      expect(response.body).toContain('payload.loginUrl');
      expect(response.body).not.toContain('cla_123#code=');
    });
  });

  it('serves the completed CLI login page with a close instruction', async (): Promise<void> => {
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        method: 'GET',
        url: browserLoginCliCompletedPathname,
      });

      expect(response.statusCode).toBe(200);
      expectNoStoreCacheControlHeader(response);
      expect(response.body).toContain(getBrowserAssetPathname('compartment-icon.svg'));
      expect(response.body).toContain('Login successful');
      expect(response.body).toContain('You can close this page.');
      expect(response.body).not.toContain('Return to the terminal to finish the CLI login.');
    });
  });

  it('starts the browser-side CLI login flow from a POST body', async (): Promise<void> => {
    mocks.startCliBrowserLogin.mockResolvedValueOnce({
      authenticatedAt: null,
      authenticatedPrincipalId: null,
      expectedPrincipalEmail: 'admin@example.com',
      expiresAt: new Date('2099-04-21T10:10:00.000Z'),
      id: 'cla_123',
      organizationSlug: 'acme-dev',
    });

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectJson(app, {
        method: 'POST',
        payload: {
          attempt: 'cla_123',
          code: 'browser-code',
        },
        url: browserLoginCliPathname,
      });

      expect(response.statusCode).toBe(200);
      expectNoStoreCacheControlHeader(response);
      expect(response.headers['referrer-policy']).toBe(browserNoReferrerPolicy);
      expect(response.headers['set-cookie']).toContain(`${compartmentCliLoginAttemptCookieName}=`);
      expect(response.json()).toEqual({
        loginUrl: '/login?organizationSlug=acme-dev',
      });
    });
  });

  it('starts the browser-side CLI login flow without a preselected organization', async (): Promise<void> => {
    mocks.startCliBrowserLogin.mockResolvedValueOnce({
      authenticatedAt: null,
      authenticatedPrincipalId: null,
      expiresAt: new Date('2099-04-21T10:10:00.000Z'),
      id: 'cla_123',
    });

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectJson(app, {
        method: 'POST',
        payload: {
          attempt: 'cla_123',
          code: 'browser-code',
        },
        url: browserLoginCliPathname,
      });

      expect(response.statusCode).toBe(200);
      expectNoStoreCacheControlHeader(response);
      expect(response.json()).toEqual({
        loginUrl: '/login',
      });
    });
  });

  it('clears stale CLI cookies and continues with a normal SSO start', async (): Promise<void> => {
    mocks.startCliBrowserLogin.mockRejectedValueOnce(createInvalidCliLoginError());
    mocks.startBrowserSsoLogin.mockResolvedValueOnce('https://accounts.google.com/o/oauth2/v2/auth?state=sso-state');

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        headers: {
          cookie: `${compartmentCliLoginAttemptCookieName}=cla_123:browser-code`,
        },
        method: 'GET',
        query: {
          provider: 'sop_123',
        },
        url: '/login/sso',
      });

      expect(response.statusCode).toBe(302);
      expectNoStoreCacheControlHeader(response);
      expect(response.headers.location).toBe('https://accounts.google.com/o/oauth2/v2/auth?state=sso-state');
      expect(response.headers['set-cookie']).toContain(`${compartmentCliLoginAttemptCookieName}=`);
      expect(mocks.startBrowserSsoLogin).toHaveBeenCalledWith({
        cliLoginAttemptId: undefined,
        flowTarget: null,
        providerId: 'sop_123',
      });
    });
  });

  it('redirects CLI-bound SSO callbacks to the completed page with browser session cookies', async (): Promise<void> => {
    mocks.completeBrowserSsoLogin.mockResolvedValueOnce({
      kind: 'cli_attempt_authenticated',
      sessionExpiresAt: new Date('2099-04-21T10:20:00.000Z'),
      sessionId: 'ses_123',
      sessionToken: 'session-token',
    });

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        method: 'GET',
        url: '/login/sso/callback?code=oidc-code&state=oidc-state',
      });

      expect(response.statusCode).toBe(302);
      expectNoStoreCacheControlHeader(response);
      expect(response.headers.location).toBe(browserLoginCliCompletedPathname);
      expect(response.headers['set-cookie']).toEqual(
        expect.arrayContaining([
          expect.stringContaining(`${compartmentSessionCookieName}=session-token`),
          expect.stringContaining(`${compartmentCliLoginAttemptCookieName}=`),
        ]),
      );
    });
  });

  it('redirects invalid CLI-bound SSO callbacks to the failed completion page', async (): Promise<void> => {
    mocks.completeBrowserSsoLogin.mockRejectedValueOnce(createInvalidCliLoginError());

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        method: 'GET',
        url: '/login/sso/callback?code=oidc-code&state=oidc-state',
      });

      expect(response.statusCode).toBe(302);
      expectNoStoreCacheControlHeader(response);
      expect(response.headers.location).toBe(`${browserLoginCliCompletedPathname}?status=failed`);
      expect(response.headers['set-cookie']).toContain(`${compartmentCliLoginAttemptCookieName}=`);
    });
  });

  it('expires CLI login attempts when SSO callbacks fail after a valid CLI-bound state lookup', async (): Promise<void> => {
    mocks.findCliLoginAttemptIdForBrowserSsoCallback.mockResolvedValueOnce('cla_123');

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        method: 'GET',
        url: '/login/sso/callback?error=access_denied&state=oidc-state',
      });

      expect(response.statusCode).toBe(302);
      expectNoStoreCacheControlHeader(response);
      expect(response.headers.location).toBe(`${browserLoginCliCompletedPathname}?status=failed`);
      expect(response.headers['set-cookie']).toContain(`${compartmentCliLoginAttemptCookieName}=`);
      expect(mocks.completeBrowserSsoLogin).not.toHaveBeenCalled();
      expect(mocks.failCliLoginAttempt).toHaveBeenCalledWith('cla_123');
    });
  });

  it('rejects ambiguous CLI-bound SSO callbacks before lookup, completion, or session cookie issuance', async (): Promise<void> => {
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        method: 'GET',
        url: '/login/sso/callback?code=oidc-code&state=oidc-state&tenant=acme&tenant=other',
      });

      expect(response.statusCode).toBe(302);
      expectNoStoreCacheControlHeader(response);
      expect(response.headers.location).toBe('/login?error=sso_failed');
      expect(String(response.headers['set-cookie'])).not.toContain(`${compartmentSessionCookieName}=`);
      expect(mocks.completeBrowserSsoLogin).not.toHaveBeenCalled();
      expect(mocks.findCliLoginAttemptIdForBrowserSsoCallback).not.toHaveBeenCalled();
      expect(mocks.failCliLoginAttempt).not.toHaveBeenCalled();
    });
  });
});
