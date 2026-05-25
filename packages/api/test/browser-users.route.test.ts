import { compartmentCsrfCookieName, compartmentSessionCookieName } from '@compartment/contracts';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ApiApp } from '../src/app.types';
import { getBrowserAssetPathname } from '../src/browser-public-paths';
import type {
  authenticateBrowserCompartmentSession,
  exchangeAppAccessCode,
  issueAppAccessRedirect,
  logoutAppAccessSession,
} from '../src/services/app-access.service';
import { applyApiRouteTestEnv, injectApiRoute, withApiRouteApp } from './api-route-test.harness';
import { expectBrowserAntiFramingHeaders } from './browser-route-security-test.helpers';
import { createBrowserCompartmentSession } from './browser-test.fixtures';
import { expectNoStoreCacheControlHeader } from './response-cache-test.helpers';

type AuthenticateBrowserCompartmentSession = typeof authenticateBrowserCompartmentSession;
type ExchangeAppAccessCode = typeof exchangeAppAccessCode;
type IssueAppAccessRedirect = typeof issueAppAccessRedirect;
type LogoutAppAccessSession = typeof logoutAppAccessSession;

interface BrowserUsersRouteMocks {
  authenticateBrowserCompartmentSession: Mock<AuthenticateBrowserCompartmentSession>;
  exchangeAppAccessCode: Mock<ExchangeAppAccessCode>;
  issueAppAccessRedirect: Mock<IssueAppAccessRedirect>;
  logoutAppAccessSession: Mock<LogoutAppAccessSession>;
}

interface AppAccessServiceMockModule {
  authenticateBrowserCompartmentSession: Mock<AuthenticateBrowserCompartmentSession>;
  exchangeAppAccessCode: Mock<ExchangeAppAccessCode>;
  issueAppAccessRedirect: Mock<IssueAppAccessRedirect>;
  logoutAppAccessSession: Mock<LogoutAppAccessSession>;
}

const mocks: BrowserUsersRouteMocks = vi.hoisted(
  (): BrowserUsersRouteMocks => ({
    authenticateBrowserCompartmentSession: vi.fn<AuthenticateBrowserCompartmentSession>(),
    exchangeAppAccessCode: vi.fn<ExchangeAppAccessCode>(),
    issueAppAccessRedirect: vi.fn<IssueAppAccessRedirect>(),
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

describe('browser users route', (): void => {
  afterEach((): void => {
    mocks.authenticateBrowserCompartmentSession.mockReset();
    mocks.exchangeAppAccessCode.mockReset();
    mocks.issueAppAccessRedirect.mockReset();
    mocks.logoutAppAccessSession.mockReset();
  });

  it('does not keep the unscoped /users browser route', async (): Promise<void> => {
    applyApiRouteTestEnv();

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        method: 'GET',
        url: '/users',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  it('renders the browser shell for an authenticated org-scoped users request', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.authenticateBrowserCompartmentSession.mockResolvedValueOnce(createBrowserCompartmentSession());

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        headers: {
          cookie: `${compartmentSessionCookieName}=session-token`,
        },
        method: 'GET',
        url: '/orgs/acme-dev/users',
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('<div id="root"></div>');
      expect(response.body).toContain(getBrowserAssetPathname('browser.js'));
      expect(response.body).toContain(getBrowserAssetPathname('styles.css'));
      expect(response.body).not.toContain('window.__COMPARTMENT_BROWSER_APP__');
      expect(response.headers['set-cookie']).toContain(`${compartmentCsrfCookieName}=`);
      expect(mocks.authenticateBrowserCompartmentSession).toHaveBeenCalledOnce();
      expectNoStoreCacheControlHeader(response);
      expectBrowserAntiFramingHeaders(response);
    });
  });
});
