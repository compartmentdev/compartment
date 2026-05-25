import { compartmentCsrfCookieName, compartmentSessionCookieName } from '@compartment/contracts';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ApiApp } from '../src/app.types';
import { browserStartOnboardingSearchParamName, getBrowserAssetPathname } from '../src/browser-public-paths';
import { browserPageRateLimitRouteOptions } from '../src/routes/browser/browser-page-rate-limit.route';
import type {
  authenticateBrowserCompartmentSession,
  exchangeAppAccessCode,
  issueAppAccessRedirect,
  logoutAppAccessSession,
} from '../src/services/app-access.service';
import type { BrowserCompartmentSession } from '../src/services/app-access.service.types';
import type { listSessionVisibleOrganizations } from '../src/services/organizations.service';
import { applyApiRouteTestEnv, injectApiRoute, withApiRouteApp } from './api-route-test.harness';
import { expectBrowserAntiFramingHeaders } from './browser-route-security-test.helpers';
import { createBrowserCompartmentSession } from './browser-test.fixtures';
import { expectNoStoreCacheControlHeader } from './response-cache-test.helpers';

type AuthenticateBrowserCompartmentSession = typeof authenticateBrowserCompartmentSession;
type ExchangeAppAccessCode = typeof exchangeAppAccessCode;
type IssueAppAccessRedirect = typeof issueAppAccessRedirect;
type ListSessionVisibleOrganizations = typeof listSessionVisibleOrganizations;
type LogoutAppAccessSession = typeof logoutAppAccessSession;

interface BrowserProjectsRouteMocks {
  authenticateBrowserCompartmentSession: Mock<AuthenticateBrowserCompartmentSession>;
  exchangeAppAccessCode: Mock<ExchangeAppAccessCode>;
  issueAppAccessRedirect: Mock<IssueAppAccessRedirect>;
  listSessionVisibleOrganizations: Mock<ListSessionVisibleOrganizations>;
  logoutAppAccessSession: Mock<LogoutAppAccessSession>;
}

const browserPageRateLimitMaxRequests: number = browserPageRateLimitRouteOptions.config.rateLimit.max;

interface AppAccessServiceMockModule {
  authenticateBrowserCompartmentSession: Mock<AuthenticateBrowserCompartmentSession>;
  exchangeAppAccessCode: Mock<ExchangeAppAccessCode>;
  issueAppAccessRedirect: Mock<IssueAppAccessRedirect>;
  logoutAppAccessSession: Mock<LogoutAppAccessSession>;
}

interface OrganizationsServiceMockModule {
  listSessionVisibleOrganizations: Mock<ListSessionVisibleOrganizations>;
}

const mocks: BrowserProjectsRouteMocks = vi.hoisted(
  (): BrowserProjectsRouteMocks => ({
    authenticateBrowserCompartmentSession: vi.fn<AuthenticateBrowserCompartmentSession>(),
    exchangeAppAccessCode: vi.fn<ExchangeAppAccessCode>(),
    issueAppAccessRedirect: vi.fn<IssueAppAccessRedirect>(),
    listSessionVisibleOrganizations: vi.fn<ListSessionVisibleOrganizations>(),
    logoutAppAccessSession: vi.fn<LogoutAppAccessSession>(),
  }),
);

vi.mock(
  '../src/services/app-access.service',
  (): AppAccessServiceMockModule => ({
    authenticateBrowserCompartmentSession: mocks.authenticateBrowserCompartmentSession,
    exchangeAppAccessCode: mocks.exchangeAppAccessCode,
    issueAppAccessRedirect: mocks.issueAppAccessRedirect,
    logoutAppAccessSession: mocks.logoutAppAccessSession,
  }),
);

vi.mock(
  '../src/services/organizations.service',
  (): OrganizationsServiceMockModule => ({
    listSessionVisibleOrganizations: mocks.listSessionVisibleOrganizations,
  }),
);

describe('browser projects home route', (): void => {
  afterEach((): void => {
    mocks.authenticateBrowserCompartmentSession.mockReset();
    mocks.exchangeAppAccessCode.mockReset();
    mocks.issueAppAccessRedirect.mockReset();
    mocks.listSessionVisibleOrganizations.mockReset();
    mocks.logoutAppAccessSession.mockReset();
  });

  it('redirects the browser root to login when no session is present', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.authenticateBrowserCompartmentSession.mockResolvedValueOnce(null);

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        method: 'GET',
        url: '/',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe('/login');
      expectNoStoreCacheControlHeader(response);
      expectBrowserAntiFramingHeaders(response);
    });
  });

  it('renders the browser shell at the browser root when a multi-org session still needs organization selection', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.authenticateBrowserCompartmentSession.mockResolvedValueOnce(createBrowserCompartmentSession());
    mocks.listSessionVisibleOrganizations.mockResolvedValueOnce([
      {
        id: 'org_123',
        name: 'Acme Dev',
        slug: 'acme-dev',
      },
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
        url: '/',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain('<div id="root"></div>');
      expect(response.body).toContain(getBrowserAssetPathname('browser.js'));
      expect(response.body).toContain(getBrowserAssetPathname('styles.css'));
      expect(response.headers['set-cookie']).toContain(`${compartmentCsrfCookieName}=`);
      expect(mocks.listSessionVisibleOrganizations).toHaveBeenCalledOnce();
      expectNoStoreCacheControlHeader(response);
      expectBrowserAntiFramingHeaders(response);
    });
  });

  it('preserves the selected organization when redirecting the browser root', async (): Promise<void> => {
    applyApiRouteTestEnv();
    const session: BrowserCompartmentSession = createBrowserCompartmentSession();
    session.authSession.organizationId = 'org_456';
    mocks.authenticateBrowserCompartmentSession.mockResolvedValueOnce(session);
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
        url: '/',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe('/orgs/beta-dev/projects');
      expect(mocks.listSessionVisibleOrganizations).toHaveBeenCalledWith(session.authSession);
      expectBrowserAntiFramingHeaders(response);
    });
  });

  it('redirects the browser root to org-scoped onboarding when start-onboarding is requested', async (): Promise<void> => {
    applyApiRouteTestEnv();
    const session: BrowserCompartmentSession = createBrowserCompartmentSession();
    session.authSession.organizationId = 'org_456';
    mocks.authenticateBrowserCompartmentSession.mockResolvedValueOnce(session);
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
        url: `/?${browserStartOnboardingSearchParamName}=true`,
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe('/orgs/beta-dev/onboarding');
      expectBrowserAntiFramingHeaders(response);
    });
  });

  it('redirects unauthenticated start-onboarding root requests to login with onboarding intent preserved', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.authenticateBrowserCompartmentSession.mockResolvedValueOnce(null);

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        method: 'GET',
        url: `/?${browserStartOnboardingSearchParamName}=true`,
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe(`/login?${browserStartOnboardingSearchParamName}=true`);
      expectBrowserAntiFramingHeaders(response);
    });
  });

  it('preserves create-project redirects when no browser session exists', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.authenticateBrowserCompartmentSession.mockResolvedValueOnce(null);

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        method: 'GET',
        url: '/orgs/acme-dev/projects/create?method=cli&step=source',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe(
        '/login?successRedirectTo=%2Forgs%2Facme-dev%2Fprojects%2Fcreate%3Fmethod%3Dcli%26step%3Dsource',
      );
      expectBrowserAntiFramingHeaders(response);
    });
  });

  it('does not keep the old /apps browser route', async (): Promise<void> => {
    applyApiRouteTestEnv();

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        method: 'GET',
        url: '/apps',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  it('does not keep unscoped authenticated console routes', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.authenticateBrowserCompartmentSession.mockResolvedValueOnce(createBrowserCompartmentSession());

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const pathnames: string[] = [
        '/projects',
        '/projects/billing',
        '/projects/billing/deployments',
        '/projects/billing/deployments/drn_123',
        '/users',
        '/groups',
        '/roles',
        '/audit',
        '/onboarding',
      ];

      for (const pathname of pathnames) {
        const response: LightMyRequestResponse = await injectApiRoute(app, {
          headers: {
            cookie: `${compartmentSessionCookieName}=session-token`,
          },
          method: 'GET',
          url: pathname,
        });

        expect(response.statusCode).toBe(404);
      }
    });
  });

  it('renders the create project shell for an authenticated project create request', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.authenticateBrowserCompartmentSession.mockResolvedValueOnce(createBrowserCompartmentSession());

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        headers: {
          cookie: 'compartment_session=session-token',
        },
        method: 'GET',
        url: '/projects/create',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain('<title>Create project</title>');
      expect(response.body).not.toContain('<title>Project Overview</title>');
      expect(response.body).toContain(getBrowserAssetPathname('browser.js'));
      expect(response.body).toContain(getBrowserAssetPathname('styles.css'));
      expect(response.headers['set-cookie']).toContain('compartment_csrf=');
      expectBrowserAntiFramingHeaders(response);
    });
  });

  it('renders the create project shell for an authenticated organization-scoped project create request', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.authenticateBrowserCompartmentSession.mockResolvedValueOnce(createBrowserCompartmentSession());

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        headers: {
          cookie: 'compartment_session=session-token',
        },
        method: 'GET',
        url: '/orgs/acme-dev/projects/create',
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('<title>Create project</title>');
      expect(response.body).not.toContain('<title>Project Overview</title>');
    });
  });

  it('renders the browser shell for authenticated organization-scoped console requests', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.authenticateBrowserCompartmentSession.mockResolvedValue(createBrowserCompartmentSession());

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const pathnames: string[] = [
        '/orgs/acme-dev/projects',
        '/orgs/acme-dev/projects/create',
        '/orgs/acme-dev/projects/billing',
        '/orgs/acme-dev/projects/billing/deployments',
        '/orgs/acme-dev/projects/billing/deployments/drn_123',
        '/orgs/acme-dev/users',
        '/orgs/acme-dev/groups',
        '/orgs/acme-dev/roles',
        '/orgs/acme-dev/audit',
        '/orgs/acme-dev/onboarding',
      ];

      for (const pathname of pathnames) {
        const response: LightMyRequestResponse = await injectApiRoute(app, {
          headers: {
            cookie: `${compartmentSessionCookieName}=session-token`,
          },
          method: 'GET',
          url: pathname,
        });

        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toContain('text/html');
        expect(response.body).toContain('<div id="root"></div>');
        expect(response.body).toContain(getBrowserAssetPathname('browser.js'));
        expect(response.body).toContain(getBrowserAssetPathname('styles.css'));
        expect(response.headers['set-cookie']).toContain(`${compartmentCsrfCookieName}=`);
        expectBrowserAntiFramingHeaders(response);
      }

      expect(mocks.authenticateBrowserCompartmentSession).toHaveBeenCalledTimes(pathnames.length);
    });
  });

  it('rate limits repeated authenticated requests to /', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.authenticateBrowserCompartmentSession.mockResolvedValue(createBrowserCompartmentSession());
    mocks.listSessionVisibleOrganizations.mockResolvedValue([
      {
        id: 'org_123',
        name: 'Acme Dev',
        slug: 'acme-dev',
      },
      {
        id: 'org_456',
        name: 'Beta Dev',
        slug: 'beta-dev',
      },
    ]);

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      for (let attempt: number = 0; attempt < browserPageRateLimitMaxRequests; attempt += 1) {
        const response: LightMyRequestResponse = await injectApiRoute(app, {
          headers: {
            cookie: `${compartmentSessionCookieName}=session-token`,
          },
          method: 'GET',
          url: '/',
        });

        expect(response.statusCode).toBe(200);
      }

      const limitedResponse: LightMyRequestResponse = await injectApiRoute(app, {
        headers: {
          cookie: `${compartmentSessionCookieName}=session-token`,
        },
        method: 'GET',
        url: '/',
      });

      expect(limitedResponse.statusCode).toBe(429);
      expectBrowserAntiFramingHeaders(limitedResponse);
      expect(mocks.authenticateBrowserCompartmentSession).toHaveBeenCalledTimes(browserPageRateLimitMaxRequests * 2);
    });
  });

  it('rate limits repeated authenticated requests to organization-scoped projects', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.authenticateBrowserCompartmentSession.mockResolvedValue(createBrowserCompartmentSession());

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      for (let attempt: number = 0; attempt < browserPageRateLimitMaxRequests; attempt += 1) {
        const response: LightMyRequestResponse = await injectApiRoute(app, {
          headers: {
            cookie: `${compartmentSessionCookieName}=session-token`,
          },
          method: 'GET',
          url: '/orgs/acme-dev/projects',
        });

        expect(response.statusCode).toBe(200);
      }

      const limitedResponse: LightMyRequestResponse = await injectApiRoute(app, {
        headers: {
          cookie: `${compartmentSessionCookieName}=session-token`,
        },
        method: 'GET',
        url: '/orgs/acme-dev/projects',
      });

      expect(limitedResponse.statusCode).toBe(429);
      expectBrowserAntiFramingHeaders(limitedResponse);
      expect(mocks.authenticateBrowserCompartmentSession).toHaveBeenCalledTimes(browserPageRateLimitMaxRequests);
    });
  });
});
