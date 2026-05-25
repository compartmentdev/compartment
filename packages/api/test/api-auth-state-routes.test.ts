import { compartmentCliLoginAttemptCookieName, compartmentSessionCookieName } from '@compartment/contracts';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ApiApp } from '../src/app.types';
import { browserHomePathname, browserLoginCliCompletedPathname } from '../src/browser-public-paths';
import { authApiLoginDiscoveryPathname, authApiLoginStatePathname } from '../src/routes/auth/auth-api-paths';
import type {
  authenticateBrowserCompartmentSession,
  canIssueAppAccessRedirect,
  issueAppAccessRedirect,
} from '../src/services/app-access.service';
import type { BrowserCompartmentSession } from '../src/services/app-access.service.types';
import type { requireInstalledCompartment } from '../src/services/app-access-target.service';
import type {
  discoverBrowserLoginState,
  readInitialBrowserLoginState,
  readTrustedInitialBrowserLoginState,
} from '../src/services/browser-login-flow.service';
import type {
  completeCliLoginAttemptFromBrowserSessionCookie,
  readCliLoginAttemptFromBrowserCookie,
} from '../src/services/browser-cli-login-flow.service';
import type { listSessionVisibleOrganizations } from '../src/services/organizations.service';
import {
  applyApiRouteTestEnv,
  expectJsonError,
  injectJson,
  injectApiRoute,
  withApiRouteApp,
} from './api-route-test.harness';
import { apiRouteRateLimitPolicies } from '../src/http/rate-limit-policies';
import { createBrowserCompartmentSession } from './browser-test.fixtures';
import { expectNoStoreCacheControlHeader } from './response-cache-test.helpers';

type AuthenticateBrowserCompartmentSession = typeof authenticateBrowserCompartmentSession;
type CanIssueAppAccessRedirect = typeof canIssueAppAccessRedirect;
type CompleteCliLoginAttemptFromBrowserSessionCookie = typeof completeCliLoginAttemptFromBrowserSessionCookie;
type DiscoverBrowserLoginState = typeof discoverBrowserLoginState;
type IssueAppAccessRedirect = typeof issueAppAccessRedirect;
type ListSessionVisibleOrganizations = typeof listSessionVisibleOrganizations;
type ReadCliLoginAttemptFromBrowserCookie = typeof readCliLoginAttemptFromBrowserCookie;
type ReadInitialBrowserLoginState = typeof readInitialBrowserLoginState;
type ReadTrustedInitialBrowserLoginState = typeof readTrustedInitialBrowserLoginState;
type RequireInstalledCompartment = typeof requireInstalledCompartment;

interface ApiAuthStateRouteMocks {
  authenticateBrowserCompartmentSession: Mock<AuthenticateBrowserCompartmentSession>;
  canIssueAppAccessRedirect: Mock<CanIssueAppAccessRedirect>;
  completeCliLoginAttemptFromBrowserSessionCookie: Mock<CompleteCliLoginAttemptFromBrowserSessionCookie>;
  discoverBrowserLoginState: Mock<DiscoverBrowserLoginState>;
  issueAppAccessRedirect: Mock<IssueAppAccessRedirect>;
  listSessionVisibleOrganizations: Mock<ListSessionVisibleOrganizations>;
  readCliLoginAttemptFromBrowserCookie: Mock<ReadCliLoginAttemptFromBrowserCookie>;
  readInitialBrowserLoginState: Mock<ReadInitialBrowserLoginState>;
  readTrustedInitialBrowserLoginState: Mock<ReadTrustedInitialBrowserLoginState>;
  requireInstalledCompartment: Mock<RequireInstalledCompartment>;
}

const authApiStateRouteBudget: number = apiRouteRateLimitPolicies.authState.max;
const authApiDiscoveryRouteBudget: number = apiRouteRateLimitPolicies.authLoginDiscoverySource.max;

const mocks: ApiAuthStateRouteMocks = vi.hoisted(
  (): ApiAuthStateRouteMocks => ({
    authenticateBrowserCompartmentSession: vi.fn<AuthenticateBrowserCompartmentSession>(),
    canIssueAppAccessRedirect: vi.fn<CanIssueAppAccessRedirect>(),
    completeCliLoginAttemptFromBrowserSessionCookie: vi.fn<CompleteCliLoginAttemptFromBrowserSessionCookie>(),
    discoverBrowserLoginState: vi.fn<DiscoverBrowserLoginState>(),
    issueAppAccessRedirect: vi.fn<IssueAppAccessRedirect>(),
    listSessionVisibleOrganizations: vi.fn<ListSessionVisibleOrganizations>(),
    readCliLoginAttemptFromBrowserCookie: vi.fn<ReadCliLoginAttemptFromBrowserCookie>(),
    readInitialBrowserLoginState: vi.fn<ReadInitialBrowserLoginState>(),
    readTrustedInitialBrowserLoginState: vi.fn<ReadTrustedInitialBrowserLoginState>(),
    requireInstalledCompartment: vi.fn<RequireInstalledCompartment>(),
  }),
);

const authApiLoginStateFlowQuery: Record<string, string> = {
  host: 'billing.localhost',
  path: '/dashboard',
  state: 'flow',
};

const authApiLoginStateNoRedirectQuery: Record<string, string> = {
  autoRedirect: 'false',
};

vi.mock(
  '../src/services/app-access.service',
  (): {
    authenticateBrowserCompartmentSession: Mock<AuthenticateBrowserCompartmentSession>;
    canIssueAppAccessRedirect: Mock<CanIssueAppAccessRedirect>;
    issueAppAccessRedirect: Mock<IssueAppAccessRedirect>;
  } => ({
    authenticateBrowserCompartmentSession: mocks.authenticateBrowserCompartmentSession,
    canIssueAppAccessRedirect: mocks.canIssueAppAccessRedirect,
    issueAppAccessRedirect: mocks.issueAppAccessRedirect,
  }),
);

vi.mock(
  '../src/services/app-access-target.service',
  (): { requireInstalledCompartment: Mock<RequireInstalledCompartment> } => ({
    requireInstalledCompartment: mocks.requireInstalledCompartment,
  }),
);

vi.mock(
  '../src/services/browser-cli-login-flow.service',
  (): {
    completeCliLoginAttemptFromBrowserSessionCookie: Mock<CompleteCliLoginAttemptFromBrowserSessionCookie>;
    readCliLoginAttemptFromBrowserCookie: Mock<ReadCliLoginAttemptFromBrowserCookie>;
  } => ({
    completeCliLoginAttemptFromBrowserSessionCookie: mocks.completeCliLoginAttemptFromBrowserSessionCookie,
    readCliLoginAttemptFromBrowserCookie: mocks.readCliLoginAttemptFromBrowserCookie,
  }),
);

vi.mock(
  '../src/services/browser-login-flow.service',
  (): {
    discoverBrowserLoginState: Mock<DiscoverBrowserLoginState>;
    readInitialBrowserLoginState: Mock<ReadInitialBrowserLoginState>;
    readTrustedInitialBrowserLoginState: Mock<ReadTrustedInitialBrowserLoginState>;
  } => ({
    discoverBrowserLoginState: mocks.discoverBrowserLoginState,
    readInitialBrowserLoginState: mocks.readInitialBrowserLoginState,
    readTrustedInitialBrowserLoginState: mocks.readTrustedInitialBrowserLoginState,
  }),
);

vi.mock(
  '../src/services/organizations.service',
  (): { listSessionVisibleOrganizations: Mock<ListSessionVisibleOrganizations> } => ({
    listSessionVisibleOrganizations: mocks.listSessionVisibleOrganizations,
  }),
);

describe('api auth state routes', (): void => {
  afterEach((): void => {
    Object.values(mocks).forEach((mock: Mock): void => {
      mock.mockReset();
    });
  });

  it('returns single-org initial browser login methods without embedded document bootstrap', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.authenticateBrowserCompartmentSession.mockResolvedValueOnce(null);
    mocks.readCliLoginAttemptFromBrowserCookie.mockResolvedValueOnce({ status: 'missing' });
    mocks.readInitialBrowserLoginState.mockResolvedValueOnce({
      flowTarget: null,
      kind: 'methods',
      localPasswordEnabled: false,
      organizationSlug: 'acme-dev',
      ssoOptions: [
        {
          buttonText: 'Continue with Google',
          displayName: 'Google Workspace',
          loginUrl: '/login/sso?provider=sop_123',
          providerId: 'sop_123',
          preset: 'google',
        },
      ],
    });

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        method: 'GET',
        url: authApiLoginStatePathname,
      });

      expect(response.statusCode).toBe(200);
      expectNoStoreCacheControlHeader(response);
      expect(response.json()).toEqual({
        flowTarget: null,
        localPasswordEnabled: false,
        organizationSlug: 'acme-dev',
        ssoOptions: [
          {
            buttonText: 'Continue with Google',
            loginUrl: '/login/sso?provider=sop_123',
            providerId: 'sop_123',
          },
        ],
        view: 'methods',
      });
      expect(mocks.readInitialBrowserLoginState).toHaveBeenCalledWith(null, true);
    });
  });

  it('disables initial login auto-redirect when requested by the browser login page', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.authenticateBrowserCompartmentSession.mockResolvedValueOnce(null);
    mocks.readCliLoginAttemptFromBrowserCookie.mockResolvedValueOnce({ status: 'missing' });
    mocks.readInitialBrowserLoginState.mockResolvedValueOnce({
      flowTarget: null,
      kind: 'methods',
      localPasswordEnabled: false,
      ssoOptions: [
        {
          buttonText: 'Continue with Google',
          displayName: 'Google Workspace',
          loginUrl: '/login/sso?provider=sop_123',
          providerId: 'sop_123',
          preset: 'google',
        },
      ],
    });

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        method: 'GET',
        query: authApiLoginStateNoRedirectQuery,
        url: authApiLoginStatePathname,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        flowTarget: null,
        localPasswordEnabled: false,
        ssoOptions: [
          {
            buttonText: 'Continue with Google',
            loginUrl: '/login/sso?provider=sop_123',
            providerId: 'sop_123',
          },
        ],
        view: 'methods',
      });
      expect(mocks.readInitialBrowserLoginState).toHaveBeenCalledWith(null, false);
    });
  });

  it('rate limits repeated v1 auth login state requests', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.authenticateBrowserCompartmentSession.mockResolvedValue(null);
    mocks.readCliLoginAttemptFromBrowserCookie.mockResolvedValue({ status: 'missing' });
    mocks.readInitialBrowserLoginState.mockResolvedValue({
      flowTarget: null,
      kind: 'email_entry',
    });

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      for (let attempt: number = 0; attempt < authApiStateRouteBudget; attempt += 1) {
        const response: LightMyRequestResponse = await injectApiRoute(app, {
          method: 'GET',
          url: authApiLoginStatePathname,
        });

        expect(response.statusCode).toBe(200);
      }

      const limitedResponse: LightMyRequestResponse = await injectApiRoute(app, {
        method: 'GET',
        url: authApiLoginStatePathname,
      });

      expectJsonError(limitedResponse, 429, 'api_rate_limit_exceeded');
      expect(mocks.readInitialBrowserLoginState).toHaveBeenCalledTimes(authApiStateRouteBudget);
    });
  });

  it('returns a console redirect state when a browser session already exists', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.authenticateBrowserCompartmentSession.mockResolvedValueOnce(createBrowserCompartmentSession());
    mocks.readCliLoginAttemptFromBrowserCookie.mockResolvedValueOnce({ status: 'missing' });

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        headers: {
          cookie: `${compartmentSessionCookieName}=session-token`,
        },
        method: 'GET',
        url: authApiLoginStatePathname,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        flowTarget: null,
        principalEmail: 'admin@example.com',
        redirectTo: browserHomePathname,
        view: 'redirect',
      });
      expect(mocks.readInitialBrowserLoginState).not.toHaveBeenCalled();
    });
  });

  it('preserves the selected organization in existing browser session redirects', async (): Promise<void> => {
    applyApiRouteTestEnv();
    const session: BrowserCompartmentSession = createBrowserCompartmentSession();
    session.authSession.organizationId = 'org_456';
    mocks.authenticateBrowserCompartmentSession.mockResolvedValueOnce(session);
    mocks.readCliLoginAttemptFromBrowserCookie.mockResolvedValueOnce({ status: 'missing' });
    mocks.listSessionVisibleOrganizations.mockResolvedValueOnce([
      {
        id: 'org_456',
        name: 'Beta Dev',
        slug: 'beta-dev',
      },
    ]);

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        headers: {
          cookie: `${compartmentSessionCookieName}=session-token`,
        },
        method: 'GET',
        url: authApiLoginStatePathname,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        flowTarget: null,
        principalEmail: 'admin@example.com',
        redirectTo: '/orgs/beta-dev/projects',
        view: 'redirect',
      });
      expect(mocks.listSessionVisibleOrganizations).toHaveBeenCalledWith(session.authSession);
    });
  });

  it('rejects existing browser session redirects when the selected organization is not session-visible', async (): Promise<void> => {
    applyApiRouteTestEnv();
    const session: BrowserCompartmentSession = createBrowserCompartmentSession();
    session.authSession.organizationId = 'org_456';
    mocks.authenticateBrowserCompartmentSession.mockResolvedValueOnce(session);
    mocks.readCliLoginAttemptFromBrowserCookie.mockResolvedValueOnce({ status: 'missing' });
    mocks.listSessionVisibleOrganizations.mockResolvedValueOnce([
      {
        id: 'org_123',
        name: 'Acme Dev',
        slug: 'acme-dev',
      },
    ]);

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        headers: {
          cookie: `${compartmentSessionCookieName}=session-token`,
        },
        method: 'GET',
        url: authApiLoginStatePathname,
      });

      expectJsonError(response, 403, 'forbidden');
      expect(mocks.readInitialBrowserLoginState).not.toHaveBeenCalled();
    });
  });

  it('finishes a CLI attempt from an existing matching browser session', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.authenticateBrowserCompartmentSession.mockResolvedValueOnce(createBrowserCompartmentSession());
    mocks.readCliLoginAttemptFromBrowserCookie.mockResolvedValueOnce({
      attempt: {
        authenticatedAt: null,
        authenticatedPrincipalId: null,
        expectedPrincipalEmail: 'admin@example.com',
        expiresAt: new Date('2099-04-21T10:10:00.000Z'),
        id: 'cla_123',
        organizationSlug: 'acme-dev',
      },
      status: 'active',
    });
    mocks.completeCliLoginAttemptFromBrowserSessionCookie.mockResolvedValueOnce('completed');

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        headers: {
          cookie: `${compartmentSessionCookieName}=session-token; ${compartmentCliLoginAttemptCookieName}=cla_123:browser-code`,
        },
        method: 'GET',
        url: authApiLoginStatePathname,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        flowTarget: null,
        principalEmail: 'admin@example.com',
        redirectTo: browserLoginCliCompletedPathname,
        view: 'redirect',
      });
      expect(response.headers['set-cookie']).toContain(`${compartmentCliLoginAttemptCookieName}=`);
      expect(mocks.completeCliLoginAttemptFromBrowserSessionCookie).toHaveBeenCalledWith(
        `${compartmentSessionCookieName}=session-token; ${compartmentCliLoginAttemptCookieName}=cla_123:browser-code`,
        {
          authMethodKind: 'password',
          oidcProviderId: null,
          organizationId: null,
          principalEmail: 'admin@example.com',
          principalId: 'prn_123',
        },
      );
      expect(mocks.discoverBrowserLoginState).not.toHaveBeenCalled();
      expect(mocks.readInitialBrowserLoginState).not.toHaveBeenCalled();
      expect(mocks.canIssueAppAccessRedirect).not.toHaveBeenCalled();
    });
  });

  it('shows login methods when the active browser session belongs to a different principal', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.authenticateBrowserCompartmentSession.mockResolvedValueOnce(createBrowserCompartmentSession());
    mocks.readCliLoginAttemptFromBrowserCookie.mockResolvedValueOnce({
      attempt: {
        authenticatedAt: null,
        authenticatedPrincipalId: null,
        expectedPrincipalEmail: 'owner@example.com',
        expiresAt: new Date('2099-04-21T10:10:00.000Z'),
        id: 'cla_123',
        organizationSlug: 'acme-dev',
      },
      status: 'active',
    });
    mocks.completeCliLoginAttemptFromBrowserSessionCookie.mockResolvedValueOnce('different_principal');
    mocks.discoverBrowserLoginState.mockResolvedValueOnce({
      email: 'owner@example.com',
      flowTarget: null,
      kind: 'methods',
      localPasswordEnabled: false,
      organizationSlug: 'acme-dev',
      ssoOptions: [
        {
          buttonText: 'Continue with Google',
          displayName: 'Google Workspace',
          loginUrl: '/login/sso?provider=sop_123',
          providerId: 'sop_123',
          preset: 'google',
        },
      ],
    });

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        headers: {
          cookie: `${compartmentSessionCookieName}=session-token; ${compartmentCliLoginAttemptCookieName}=cla_123:browser-code`,
        },
        method: 'GET',
        url: authApiLoginStatePathname,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        email: 'owner@example.com',
        flowTarget: null,
        localPasswordEnabled: false,
        organizationSlug: 'acme-dev',
        principalEmail: 'admin@example.com',
        ssoOptions: [
          {
            buttonText: 'Continue with Google',
            loginUrl: '/login/sso?provider=sop_123',
            providerId: 'sop_123',
          },
        ],
        view: 'methods',
      });
      expect(mocks.discoverBrowserLoginState).toHaveBeenCalledWith(
        {
          email: 'owner@example.com',
          flowTarget: null,
          organizationSlug: 'acme-dev',
        },
        false,
      );
      expect(mocks.completeCliLoginAttemptFromBrowserSessionCookie).toHaveBeenCalledOnce();
      expect(mocks.canIssueAppAccessRedirect).not.toHaveBeenCalled();
    });
  });

  it('preserves SSO auto-redirect for a CLI attempt before the browser has an authenticated session', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.authenticateBrowserCompartmentSession.mockResolvedValueOnce(null);
    mocks.readCliLoginAttemptFromBrowserCookie.mockResolvedValueOnce({
      attempt: {
        authenticatedAt: null,
        authenticatedPrincipalId: null,
        expectedPrincipalEmail: 'owner@example.com',
        expiresAt: new Date('2099-04-21T10:10:00.000Z'),
        id: 'cla_123',
        organizationSlug: 'acme-dev',
      },
      status: 'active',
    });
    mocks.discoverBrowserLoginState.mockResolvedValueOnce({
      kind: 'redirect',
      redirectUrl: '/login/sso?provider=sop_123',
    });

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        headers: {
          cookie: `${compartmentSessionCookieName}=session-token; ${compartmentCliLoginAttemptCookieName}=cla_123:browser-code`,
        },
        method: 'GET',
        url: authApiLoginStatePathname,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        flowTarget: null,
        redirectTo: '/login/sso?provider=sop_123',
        view: 'redirect',
      });
      expect(mocks.discoverBrowserLoginState).toHaveBeenCalledWith(
        {
          email: 'owner@example.com',
          flowTarget: null,
          organizationSlug: 'acme-dev',
        },
        true,
      );
      expect(mocks.completeCliLoginAttemptFromBrowserSessionCookie).not.toHaveBeenCalled();
      expect(mocks.canIssueAppAccessRedirect).not.toHaveBeenCalled();
    });
  });

  it('keeps trusted preselected organization state for a CLI attempt without a fixed email', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.authenticateBrowserCompartmentSession.mockResolvedValueOnce(null);
    mocks.readCliLoginAttemptFromBrowserCookie.mockResolvedValueOnce({
      attempt: {
        authenticatedAt: null,
        authenticatedPrincipalId: null,
        expiresAt: new Date('2099-04-21T10:10:00.000Z'),
        id: 'cla_123',
        organizationSlug: 'acme-dev',
      },
      status: 'active',
    });
    mocks.discoverBrowserLoginState.mockResolvedValueOnce({
      flowTarget: null,
      kind: 'methods',
      localPasswordEnabled: false,
      organizationSlug: 'acme-dev',
      ssoOptions: [
        {
          buttonText: 'Continue with Google',
          displayName: 'Google Workspace',
          loginUrl: '/login/sso?provider=sop_123',
          providerId: 'sop_123',
          preset: 'google',
        },
      ],
    });

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        headers: {
          cookie: `${compartmentSessionCookieName}=session-token; ${compartmentCliLoginAttemptCookieName}=cla_123:browser-code`,
        },
        method: 'GET',
        url: authApiLoginStatePathname,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        flowTarget: null,
        localPasswordEnabled: false,
        organizationSlug: 'acme-dev',
        ssoOptions: [
          {
            buttonText: 'Continue with Google',
            loginUrl: '/login/sso?provider=sop_123',
            providerId: 'sop_123',
          },
        ],
        view: 'methods',
      });
      expect(mocks.discoverBrowserLoginState).toHaveBeenCalledWith(
        {
          flowTarget: null,
          organizationSlug: 'acme-dev',
        },
        true,
      );
      expect(mocks.readInitialBrowserLoginState).not.toHaveBeenCalled();
      expect(mocks.completeCliLoginAttemptFromBrowserSessionCookie).not.toHaveBeenCalled();
      expect(mocks.canIssueAppAccessRedirect).not.toHaveBeenCalled();
    });
  });

  it('shows an unscoped CLI attempt with trusted browser login state before the browser has a session', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.authenticateBrowserCompartmentSession.mockResolvedValueOnce(null);
    mocks.readCliLoginAttemptFromBrowserCookie.mockResolvedValueOnce({
      attempt: {
        authenticatedAt: null,
        authenticatedPrincipalId: null,
        expiresAt: new Date('2099-04-21T10:10:00.000Z'),
        id: 'cla_123',
      },
      status: 'active',
    });
    mocks.readTrustedInitialBrowserLoginState.mockResolvedValueOnce({
      flowTarget: null,
      kind: 'methods',
      localPasswordEnabled: true,
      ssoOptions: [],
    });

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        headers: {
          cookie: `${compartmentSessionCookieName}=session-token; ${compartmentCliLoginAttemptCookieName}=cla_123:browser-code`,
        },
        method: 'GET',
        url: authApiLoginStatePathname,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        flowTarget: null,
        localPasswordEnabled: true,
        ssoOptions: [],
        view: 'methods',
      });
      expect(mocks.readTrustedInitialBrowserLoginState).toHaveBeenCalledWith(null, true);
      expect(mocks.readInitialBrowserLoginState).not.toHaveBeenCalled();
      expect(mocks.discoverBrowserLoginState).not.toHaveBeenCalled();
      expect(mocks.completeCliLoginAttemptFromBrowserSessionCookie).not.toHaveBeenCalled();
      expect(mocks.canIssueAppAccessRedirect).not.toHaveBeenCalled();
    });
  });

  it('redirects an invalid CLI attempt to the failed terminal completion page', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.authenticateBrowserCompartmentSession.mockResolvedValueOnce(createBrowserCompartmentSession());
    mocks.readCliLoginAttemptFromBrowserCookie.mockResolvedValueOnce({ status: 'invalid' });

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        headers: {
          cookie: `${compartmentSessionCookieName}=session-token; ${compartmentCliLoginAttemptCookieName}=cla_123:browser-code`,
        },
        method: 'GET',
        url: authApiLoginStatePathname,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        flowTarget: null,
        principalEmail: 'admin@example.com',
        redirectTo: `${browserLoginCliCompletedPathname}?status=failed`,
        view: 'redirect',
      });
      expect(response.headers['set-cookie']).toContain(`${compartmentCliLoginAttemptCookieName}=`);
      expect(mocks.readInitialBrowserLoginState).not.toHaveBeenCalled();
      expect(mocks.canIssueAppAccessRedirect).not.toHaveBeenCalled();
    });
  });

  it('suppresses authenticated browser auto-redirect when the login page disables it', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.authenticateBrowserCompartmentSession.mockResolvedValueOnce(createBrowserCompartmentSession());
    mocks.readCliLoginAttemptFromBrowserCookie.mockResolvedValueOnce({ status: 'missing' });
    mocks.readInitialBrowserLoginState.mockResolvedValueOnce({
      flowTarget: null,
      kind: 'email_entry',
    });

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        headers: {
          cookie: `${compartmentSessionCookieName}=session-token`,
        },
        method: 'GET',
        query: authApiLoginStateNoRedirectQuery,
        url: authApiLoginStatePathname,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        flowTarget: null,
        principalEmail: 'admin@example.com',
        view: 'email_entry',
      });
      expect(mocks.readInitialBrowserLoginState).toHaveBeenCalledWith(null, false);
      expect(mocks.canIssueAppAccessRedirect).not.toHaveBeenCalled();
      expect(mocks.issueAppAccessRedirect).not.toHaveBeenCalled();
    });
  });

  it('returns an app-access redirect state when an authenticated browser session can enter the app flow', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.authenticateBrowserCompartmentSession.mockResolvedValueOnce(createBrowserCompartmentSession());
    mocks.readCliLoginAttemptFromBrowserCookie.mockResolvedValueOnce({ status: 'missing' });
    mocks.canIssueAppAccessRedirect.mockResolvedValueOnce(true);
    mocks.issueAppAccessRedirect.mockResolvedValueOnce(
      'http://billing.localhost/_compartment/callback?code=abc&state=flow',
    );

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        headers: {
          cookie: `${compartmentSessionCookieName}=session-token`,
        },
        method: 'GET',
        query: authApiLoginStateFlowQuery,
        url: authApiLoginStatePathname,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        flowTarget: {
          host: 'billing.localhost',
          path: '/dashboard',
          state: 'flow',
        },
        principalEmail: 'admin@example.com',
        redirectTo: 'http://billing.localhost/_compartment/callback?code=abc&state=flow',
        view: 'redirect',
      });
      expect(mocks.issueAppAccessRedirect).toHaveBeenCalledWith({
        authSessionId: 'ses_123',
        host: 'billing.localhost',
        redirectPath: '/dashboard',
        state: 'flow',
      });
      expect(mocks.readInitialBrowserLoginState).not.toHaveBeenCalled();
    });
  });

  it('returns initial login state when an authenticated browser session cannot enter the app flow', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.authenticateBrowserCompartmentSession.mockResolvedValueOnce(createBrowserCompartmentSession());
    mocks.readCliLoginAttemptFromBrowserCookie.mockResolvedValueOnce({ status: 'missing' });
    mocks.canIssueAppAccessRedirect.mockResolvedValueOnce(false);
    mocks.readInitialBrowserLoginState.mockResolvedValueOnce({
      flowTarget: {
        host: 'billing.localhost',
        path: '/dashboard',
        state: 'flow',
      },
      kind: 'email_entry',
    });

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        headers: {
          cookie: `${compartmentSessionCookieName}=session-token`,
        },
        method: 'GET',
        query: authApiLoginStateFlowQuery,
        url: authApiLoginStatePathname,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        flowTarget: {
          host: 'billing.localhost',
          path: '/dashboard',
          state: 'flow',
        },
        principalEmail: 'admin@example.com',
        view: 'email_entry',
      });
      expect(mocks.issueAppAccessRedirect).not.toHaveBeenCalled();
      expect(mocks.readInitialBrowserLoginState).toHaveBeenCalledWith(
        {
          host: 'billing.localhost',
          path: '/dashboard',
          state: 'flow',
        },
        true,
      );
    });
  });

  it('discovers browser login methods through the v1 auth API', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.discoverBrowserLoginState.mockResolvedValueOnce({
      email: 'admin@example.com',
      flowTarget: null,
      kind: 'methods',
      localPasswordEnabled: true,
      organizationSlug: 'acme-dev',
      ssoOptions: [
        {
          buttonText: 'Continue with Google',
          displayName: 'Google Workspace',
          loginUrl: '/login/sso?provider=sop_123',
          providerId: 'sop_123',
          preset: 'google',
        },
      ],
    });

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectJson(app, {
        method: 'POST',
        payload: {
          email: 'admin@example.com',
        },
        url: authApiLoginDiscoveryPathname,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        email: 'admin@example.com',
        flowTarget: null,
        localPasswordEnabled: true,
        organizationSlug: 'acme-dev',
        ssoOptions: [
          {
            buttonText: 'Continue with Google',
            loginUrl: '/login/sso?provider=sop_123',
            providerId: 'sop_123',
          },
        ],
        view: 'methods',
      });
    });
  });

  it('rate limits repeated v1 auth login discovery requests', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.discoverBrowserLoginState.mockResolvedValue({
      email: 'admin@example.com',
      flowTarget: null,
      kind: 'methods',
      localPasswordEnabled: true,
      organizationSlug: 'acme-dev',
      ssoOptions: [],
    });

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      for (let attempt: number = 0; attempt < authApiDiscoveryRouteBudget; attempt += 1) {
        const response: LightMyRequestResponse = await injectJson(app, {
          method: 'POST',
          payload: {
            email: 'admin@example.com',
          },
          url: authApiLoginDiscoveryPathname,
        });

        expect(response.statusCode).toBe(200);
      }

      const limitedResponse: LightMyRequestResponse = await injectJson(app, {
        method: 'POST',
        payload: {
          email: 'admin@example.com',
        },
        url: authApiLoginDiscoveryPathname,
      });

      expect(limitedResponse.statusCode).toBe(429);
      expect(limitedResponse.body).toContain('api_rate_limit_exceeded');
      expect(mocks.discoverBrowserLoginState).toHaveBeenCalledTimes(authApiDiscoveryRouteBudget);
    });
  });
});
