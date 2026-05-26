import { compartmentCsrfCookieName } from '@compartment/contracts';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ApiApp } from '../src/app.types';
import { getBrowserAssetPathname } from '../src/browser-public-paths';
import { createInvalidSsoLoginError } from '../src/errors/api-business-error';
import type { issueAppAccessRedirect } from '../src/services/app-access.service';
import type { requireInstalledCompartment } from '../src/services/app-access-target.service';
import type { createCompartmentSessionCookie } from '../src/services/browser-session-cookie.service';
import type {
  completeBrowserSsoLogin,
  findCliLoginAttemptIdForBrowserSsoCallback,
  startBrowserSsoLogin,
} from '../src/services/sso-oidc/sso-oidc-login.service';
import type { BrowserSsoFlowTarget, BrowserSsoLoginResult } from '../src/services/sso-oidc/sso-oidc.service.types';
import { applyApiRouteTestEnv, expectJsonError, injectApiRoute, withApiRouteApp } from './api-route-test.harness';
import { expectBrowserAntiFramingHeaders } from './browser-route-security-test.helpers';
import { createBrowserFlowTarget } from './browser-test.fixtures';
import { expectNoStoreCacheControlHeader } from './response-cache-test.helpers';

type CompleteBrowserSsoLogin = typeof completeBrowserSsoLogin;
type CreateCompartmentSessionCookie = typeof createCompartmentSessionCookie;
type FindCliLoginAttemptIdForBrowserSsoCallback = typeof findCliLoginAttemptIdForBrowserSsoCallback;
type IssueAppAccessRedirect = typeof issueAppAccessRedirect;
type RequireInstalledCompartment = typeof requireInstalledCompartment;
type StartBrowserSsoLogin = typeof startBrowserSsoLogin;

interface BrowserLoginRouteMocks {
  completeBrowserSsoLogin: Mock<CompleteBrowserSsoLogin>;
  createCompartmentSessionCookie: Mock<CreateCompartmentSessionCookie>;
  findCliLoginAttemptIdForBrowserSsoCallback: Mock<FindCliLoginAttemptIdForBrowserSsoCallback>;
  issueAppAccessRedirect: Mock<IssueAppAccessRedirect>;
  requireInstalledCompartment: Mock<RequireInstalledCompartment>;
  startBrowserSsoLogin: Mock<StartBrowserSsoLogin>;
}

const mocks: BrowserLoginRouteMocks = vi.hoisted(
  (): BrowserLoginRouteMocks => ({
    completeBrowserSsoLogin: vi.fn<CompleteBrowserSsoLogin>(),
    createCompartmentSessionCookie: vi.fn<CreateCompartmentSessionCookie>(),
    findCliLoginAttemptIdForBrowserSsoCallback: vi.fn<FindCliLoginAttemptIdForBrowserSsoCallback>(),
    issueAppAccessRedirect: vi.fn<IssueAppAccessRedirect>(),
    requireInstalledCompartment: vi.fn<RequireInstalledCompartment>(),
    startBrowserSsoLogin: vi.fn<StartBrowserSsoLogin>(),
  }),
);

vi.mock('../src/services/app-access.service', (): { issueAppAccessRedirect: Mock<IssueAppAccessRedirect> } => ({
  issueAppAccessRedirect: mocks.issueAppAccessRedirect,
}));

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

vi.mock(
  '../src/services/browser-session-cookie.service',
  (): {
    createCompartmentSessionCookie: Mock<CreateCompartmentSessionCookie>;
  } => ({
    createCompartmentSessionCookie: mocks.createCompartmentSessionCookie,
  }),
);

vi.mock(
  '../src/services/app-access-target.service',
  (): {
    requireInstalledCompartment: Mock<RequireInstalledCompartment>;
  } => ({
    requireInstalledCompartment: mocks.requireInstalledCompartment,
  }),
);

describe('browser login route', (): void => {
  afterEach((): void => {
    Object.values(mocks).forEach((mock: Mock): void => {
      mock.mockReset();
    });
  });

  it('serves the auth shell for browser login', async (): Promise<void> => {
    prepareBrowserLoginRoute();

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        method: 'GET',
        url: '/login',
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain(getBrowserAssetPathname('compartment-icon.svg'));
      expect(response.body).toContain(getBrowserAssetPathname('auth.js'));
      expect(response.body).not.toContain('__COMPARTMENT_BROWSER_APP__');
      expect(response.headers['set-cookie']).toContain(`${compartmentCsrfCookieName}=`);
      expectNoStoreCacheControlHeader(response);
      expectBrowserAntiFramingHeaders(response);
    });
  });

  it('starts the browser SSO login flow from the selected provider', async (): Promise<void> => {
    prepareBrowserLoginRoute();
    mocks.startBrowserSsoLogin.mockResolvedValueOnce('https://accounts.google.com/o/oauth2/v2/auth?state=sso-state');

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        method: 'GET',
        url: '/login/sso?provider=sop_123&host=billing.apps.localhost&path=%2Fdashboard&state=flow',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe('https://accounts.google.com/o/oauth2/v2/auth?state=sso-state');
      expect(mocks.startBrowserSsoLogin).toHaveBeenCalledWith({
        flowTarget: createBrowserFlowTarget(),
        providerId: 'sop_123',
      });
      expectBrowserAntiFramingHeaders(response);
    });
  });

  it('does not redirect to an unsafe browser SSO authorization URL', async (): Promise<void> => {
    prepareBrowserLoginRoute();
    mocks.startBrowserSsoLogin.mockResolvedValueOnce('javascript:alert(1)');

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        method: 'GET',
        url: '/login/sso?provider=sop_123&host=billing.apps.localhost&path=%2Fdashboard&state=flow',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe(
        '/login?error=sso_failed&host=billing.apps.localhost&path=%2Fdashboard&state=flow',
      );
      expectBrowserAntiFramingHeaders(response);
    });
  });

  it('redirects back to login with an error after an invalid SSO start', async (): Promise<void> => {
    prepareBrowserLoginRoute();
    mocks.startBrowserSsoLogin.mockRejectedValueOnce(createInvalidSsoLoginError());

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        method: 'GET',
        url: '/login/sso?provider=sop_123&host=billing.apps.localhost&path=%2Fdashboard&state=flow',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe(
        '/login?error=sso_failed&host=billing.apps.localhost&path=%2Fdashboard&state=flow',
      );
      expectBrowserAntiFramingHeaders(response);
    });
  });

  it('preserves create-project redirects after an invalid SSO start', async (): Promise<void> => {
    prepareBrowserLoginRoute();
    mocks.startBrowserSsoLogin.mockRejectedValueOnce(createInvalidSsoLoginError());

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        method: 'GET',
        url: '/login/sso?provider=sop_123&successRedirectTo=%2Forgs%2Facme-dev%2Fprojects%2Fcreate',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe(
        '/login?error=sso_failed&successRedirectTo=%2Forgs%2Facme-dev%2Fprojects%2Fcreate',
      );
      expectBrowserAntiFramingHeaders(response);
    });
  });

  it('rejects browser SSO login requests with cookie-unsafe flow state', async (): Promise<void> => {
    prepareBrowserLoginRoute();

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        method: 'GET',
        url: '/login/sso?provider=sop_123&host=billing.apps.localhost&path=%2Fdashboard&state=flow%2Funsafe',
      });

      expectJsonError(response, 400, 'invalid_browser_login_query');
      expect(mocks.startBrowserSsoLogin).not.toHaveBeenCalled();
    });
  });

  it('sets the compartment cookie and redirects after a successful SSO callback', async (): Promise<void> => {
    prepareBrowserLoginRoute();
    mocks.completeBrowserSsoLogin.mockResolvedValueOnce(createBrowserSsoLoginResult(createBrowserFlowTarget()));
    mocks.createCompartmentSessionCookie.mockReturnValueOnce('sso-session-cookie');
    mocks.issueAppAccessRedirect.mockResolvedValueOnce(
      'http://billing.apps.localhost/_compartment/callback?code=abc&state=flow',
    );

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        method: 'GET',
        url: '/login/sso/callback?code=oidc-code&state=sso-state',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe('http://billing.apps.localhost/_compartment/callback?code=abc&state=flow');
      expect(response.headers['set-cookie']).toContain('sso-session-cookie');
      expectBrowserAntiFramingHeaders(response);
    });
  });

  it('preserves the selected organization after a control-plane SSO callback', async (): Promise<void> => {
    prepareBrowserLoginRoute();
    mocks.completeBrowserSsoLogin.mockResolvedValueOnce(createBrowserSsoLoginResult(null));
    mocks.createCompartmentSessionCookie.mockReturnValueOnce('sso-session-cookie');

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        method: 'GET',
        url: '/login/sso/callback?code=oidc-code&state=sso-state',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe('/orgs/acme-dev/projects');
      expect(response.headers['set-cookie']).toContain('sso-session-cookie');
      expect(mocks.issueAppAccessRedirect).not.toHaveBeenCalled();
      expectBrowserAntiFramingHeaders(response);
    });
  });

  it('redirects to login after an invalid SSO callback', async (): Promise<void> => {
    prepareBrowserLoginRoute();
    mocks.completeBrowserSsoLogin.mockRejectedValueOnce(createInvalidSsoLoginError());

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        method: 'GET',
        url: '/login/sso/callback?code=oidc-code&state=sso-state',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe('/login?error=sso_failed');
      expectBrowserAntiFramingHeaders(response);
    });
  });

  it('handles valid failure SSO callbacks without attempting browser session completion', async (): Promise<void> => {
    prepareBrowserLoginRoute();

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        method: 'GET',
        url: '/login/sso/callback?error=access_denied&state=sso-state',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe('/login?error=sso_failed');
      expect(mocks.completeBrowserSsoLogin).not.toHaveBeenCalled();
      expect(mocks.findCliLoginAttemptIdForBrowserSsoCallback).toHaveBeenCalledTimes(1);
      expect(mocks.createCompartmentSessionCookie).not.toHaveBeenCalled();
      expectBrowserAntiFramingHeaders(response);
    });
  });

  it('rejects ambiguous browser SSO callbacks before service completion or session issuance', async (): Promise<void> => {
    prepareBrowserLoginRoute();

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        method: 'GET',
        url: '/login/sso/callback?code=oidc-code&state=sso-state&unknown=abc&unknown=def',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe('/login?error=sso_failed');
      expect(mocks.completeBrowserSsoLogin).not.toHaveBeenCalled();
      expect(mocks.findCliLoginAttemptIdForBrowserSsoCallback).not.toHaveBeenCalled();
      expect(mocks.createCompartmentSessionCookie).not.toHaveBeenCalled();
      expectBrowserAntiFramingHeaders(response);
    });
  });

  it('rejects browser SSO callbacks with extra query parameters before service completion', async (): Promise<void> => {
    prepareBrowserLoginRoute();

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        method: 'GET',
        url: '/login/sso/callback?code=oidc-code&state=sso-state&tenant=acme',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe('/login?error=sso_failed');
      expect(mocks.completeBrowserSsoLogin).not.toHaveBeenCalled();
      expect(mocks.findCliLoginAttemptIdForBrowserSsoCallback).not.toHaveBeenCalled();
      expect(mocks.createCompartmentSessionCookie).not.toHaveBeenCalled();
      expectBrowserAntiFramingHeaders(response);
    });
  });
});

function prepareBrowserLoginRoute(): void {
  applyApiRouteTestEnv();
  mocks.requireInstalledCompartment.mockResolvedValue();
}

function createBrowserSsoLoginResult(flowTarget: BrowserSsoFlowTarget): BrowserSsoLoginResult {
  return {
    authSession: {
      authMethodKind: 'oidc',
      oidcProviderId: 'sop_123',
      organizationId: 'org_123',
      principalId: 'prn_123',
    },
    flowTarget,
    kind: 'browser_session',
    organizations: [
      {
        id: 'org_123',
        name: 'Acme Dev',
        slug: 'acme-dev',
      },
    ],
    principalEmail: 'admin@example.com',
    principalId: 'prn_123',
    sessionExpiresAt: new Date('2099-04-21T11:00:00.000Z'),
    sessionId: 'ses_123',
    sessionToken: 'sso-session-token',
  };
}
