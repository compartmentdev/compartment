import {
  compartmentCsrfCookieName,
  compartmentCsrfHeaderName,
  compartmentSessionCookieName,
} from '@compartment/contracts';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ApiApp } from '../src/app.types';
import { browserActivatePathname } from '../src/browser-public-paths';
import { createInvalidBootstrapTokenError, createNotInstalledError } from '../src/errors/api-business-error';
import { authApiActivatePathname } from '../src/routes/auth/auth-api-paths';
import type {
  clearSuccessfulActivationThrottle,
  readActivationThrottleBlock,
  recordFailedActivationAttempt,
} from '../src/services/activation-throttle.service';
import type { activateLocalUser } from '../src/services/activation.service';
import type { ActivateLocalUserResult } from '../src/services/activation.service.types';
import type {
  authenticateBrowserCompartmentSession,
  canIssueAppAccessRedirect,
} from '../src/services/app-access.service';
import type { requireInstalledCompartment } from '../src/services/app-access-target.service';
import type { authenticateSession } from '../src/services/authentication.service';
import type {
  consumeBrowserAuthTokenFlow,
  readBrowserAuthTokenFlowToken,
} from '../src/services/browser-auth-token-flow.service';
import type {
  clearSuccessfulLoginThrottle,
  readLoginThrottleBlock,
  recordFailedLoginAttempt,
} from '../src/services/login-throttle.service';
import type { login, loginForOrganization } from '../src/services/login.service';
import type { logout } from '../src/services/logout.service';
import type {
  listSessionVisibleOrganizations,
  resolveOrganizationForPrincipal,
} from '../src/services/organizations.service';
import type { resetPassword } from '../src/services/password-reset.service';
import type {
  clearSuccessfulResetPasswordThrottle,
  readResetPasswordThrottleBlock,
  recordFailedResetPasswordAttempt,
} from '../src/services/reset-password-throttle.service';
import {
  applyApiRouteTestEnv,
  expectJsonError,
  injectForm,
  injectJson,
  injectApiRoute,
  withApiRouteApp,
} from './api-route-test.harness';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { requireSetCookieValue } from './api-integration.harness';
import {
  mockFilterSessionVisibleOrganizationsPassthrough,
  type FilterSessionVisibleOrganizations,
} from './session-visible-organizations.mock';

type ClearSuccessfulActivationThrottle = typeof clearSuccessfulActivationThrottle;
type ClearSuccessfulLoginThrottle = typeof clearSuccessfulLoginThrottle;
type ClearSuccessfulResetPasswordThrottle = typeof clearSuccessfulResetPasswordThrottle;
type ActivateLocalUser = typeof activateLocalUser;
type AuthenticateBrowserCompartmentSession = typeof authenticateBrowserCompartmentSession;
type AuthenticateSession = typeof authenticateSession;
type CanIssueAppAccessRedirect = typeof canIssueAppAccessRedirect;
type ConsumeBrowserAuthTokenFlow = typeof consumeBrowserAuthTokenFlow;
type Login = typeof login;
type LoginForOrganization = typeof loginForOrganization;
type Logout = typeof logout;
type ListSessionVisibleOrganizations = typeof listSessionVisibleOrganizations;
type ReadActivationThrottleBlock = typeof readActivationThrottleBlock;
type ReadBrowserAuthTokenFlowToken = typeof readBrowserAuthTokenFlowToken;
type ReadLoginThrottleBlock = typeof readLoginThrottleBlock;
type ReadResetPasswordThrottleBlock = typeof readResetPasswordThrottleBlock;
type RecordFailedActivationAttempt = typeof recordFailedActivationAttempt;
type RecordFailedLoginAttempt = typeof recordFailedLoginAttempt;
type RecordFailedResetPasswordAttempt = typeof recordFailedResetPasswordAttempt;
type ResolveOrganizationForPrincipal = typeof resolveOrganizationForPrincipal;
type ResetPassword = typeof resetPassword;
type RequireInstalledCompartment = typeof requireInstalledCompartment;

interface ApiAuthRouteMocks {
  clearSuccessfulActivationThrottle: Mock<ClearSuccessfulActivationThrottle>;
  clearSuccessfulLoginThrottle: Mock<ClearSuccessfulLoginThrottle>;
  clearSuccessfulResetPasswordThrottle: Mock<ClearSuccessfulResetPasswordThrottle>;
  activateLocalUser: Mock<ActivateLocalUser>;
  authenticateBrowserCompartmentSession: Mock<AuthenticateBrowserCompartmentSession>;
  authenticateSession: Mock<AuthenticateSession>;
  canIssueAppAccessRedirect: Mock<CanIssueAppAccessRedirect>;
  consumeBrowserAuthTokenFlow: Mock<ConsumeBrowserAuthTokenFlow>;
  filterSessionVisibleOrganizations: Mock<FilterSessionVisibleOrganizations>;
  listSessionVisibleOrganizations: Mock<ListSessionVisibleOrganizations>;
  login: Mock<Login>;
  loginForOrganization: Mock<LoginForOrganization>;
  logout: Mock<Logout>;
  readActivationThrottleBlock: Mock<ReadActivationThrottleBlock>;
  readBrowserAuthTokenFlowToken: Mock<ReadBrowserAuthTokenFlowToken>;
  readLoginThrottleBlock: Mock<ReadLoginThrottleBlock>;
  readResetPasswordThrottleBlock: Mock<ReadResetPasswordThrottleBlock>;
  recordFailedActivationAttempt: Mock<RecordFailedActivationAttempt>;
  recordFailedLoginAttempt: Mock<RecordFailedLoginAttempt>;
  recordFailedResetPasswordAttempt: Mock<RecordFailedResetPasswordAttempt>;
  resolveOrganizationForPrincipal: Mock<ResolveOrganizationForPrincipal>;
  resetPassword: Mock<ResetPassword>;
  requireInstalledCompartment: Mock<RequireInstalledCompartment>;
}

interface OrganizationsServiceModuleMock {
  filterSessionVisibleOrganizations: Mock<FilterSessionVisibleOrganizations>;
  listSessionVisibleOrganizations: Mock<ListSessionVisibleOrganizations>;
  resolveOrganizationForPrincipal: Mock<ResolveOrganizationForPrincipal>;
}

interface BrowserCookieRequestHeadersOptions {
  additionalCookie?: string | undefined;
  csrfToken: string;
  host: string;
  includeCsrfHeader?: boolean | undefined;
  origin: string;
  sessionToken?: string | undefined;
}
const authApiActivationRouteBudget: number = defaultApiAuthThrottleConfig.activation.route.maxRequests;

const mocks: ApiAuthRouteMocks = vi.hoisted(
  (): ApiAuthRouteMocks => ({
    clearSuccessfulActivationThrottle: vi.fn<ClearSuccessfulActivationThrottle>(),
    clearSuccessfulLoginThrottle: vi.fn<ClearSuccessfulLoginThrottle>(),
    clearSuccessfulResetPasswordThrottle: vi.fn<ClearSuccessfulResetPasswordThrottle>(),
    activateLocalUser: vi.fn<ActivateLocalUser>(),
    authenticateBrowserCompartmentSession: vi.fn<AuthenticateBrowserCompartmentSession>(),
    authenticateSession: vi.fn<AuthenticateSession>(),
    canIssueAppAccessRedirect: vi.fn<CanIssueAppAccessRedirect>(),
    consumeBrowserAuthTokenFlow: vi.fn<ConsumeBrowserAuthTokenFlow>(),
    filterSessionVisibleOrganizations: vi.fn<FilterSessionVisibleOrganizations>(),
    listSessionVisibleOrganizations: vi.fn<ListSessionVisibleOrganizations>(),
    login: vi.fn<Login>(),
    loginForOrganization: vi.fn<LoginForOrganization>(),
    logout: vi.fn<Logout>(),
    readActivationThrottleBlock: vi.fn<ReadActivationThrottleBlock>(),
    readBrowserAuthTokenFlowToken: vi.fn<ReadBrowserAuthTokenFlowToken>(),
    readLoginThrottleBlock: vi.fn<ReadLoginThrottleBlock>(),
    readResetPasswordThrottleBlock: vi.fn<ReadResetPasswordThrottleBlock>(),
    recordFailedActivationAttempt: vi.fn<RecordFailedActivationAttempt>(),
    recordFailedLoginAttempt: vi.fn<RecordFailedLoginAttempt>(),
    recordFailedResetPasswordAttempt: vi.fn<RecordFailedResetPasswordAttempt>(),
    resolveOrganizationForPrincipal: vi.fn<ResolveOrganizationForPrincipal>(),
    resetPassword: vi.fn<ResetPassword>(),
    requireInstalledCompartment: vi.fn<RequireInstalledCompartment>(),
  }),
);

vi.mock(
  '../src/services/activation-throttle.service',
  (): {
    clearSuccessfulActivationThrottle: Mock<ClearSuccessfulActivationThrottle>;
    readActivationThrottleBlock: Mock<ReadActivationThrottleBlock>;
    recordFailedActivationAttempt: Mock<RecordFailedActivationAttempt>;
  } => ({
    clearSuccessfulActivationThrottle: mocks.clearSuccessfulActivationThrottle,
    readActivationThrottleBlock: mocks.readActivationThrottleBlock,
    recordFailedActivationAttempt: mocks.recordFailedActivationAttempt,
  }),
);

vi.mock('../src/services/activation.service', (): { activateLocalUser: Mock<ActivateLocalUser> } => ({
  activateLocalUser: mocks.activateLocalUser,
}));

vi.mock('../src/services/authentication.service', (): { authenticateSession: Mock<AuthenticateSession> } => ({
  authenticateSession: mocks.authenticateSession,
}));

vi.mock(
  '../src/services/app-access.service',
  (): {
    authenticateBrowserCompartmentSession: Mock<AuthenticateBrowserCompartmentSession>;
    canIssueAppAccessRedirect: Mock<CanIssueAppAccessRedirect>;
  } => ({
    authenticateBrowserCompartmentSession: mocks.authenticateBrowserCompartmentSession,
    canIssueAppAccessRedirect: mocks.canIssueAppAccessRedirect,
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
    consumeBrowserAuthTokenFlow: Mock<ConsumeBrowserAuthTokenFlow>;
    readBrowserAuthTokenFlowToken: Mock<ReadBrowserAuthTokenFlowToken>;
  } => ({
    consumeBrowserAuthTokenFlow: mocks.consumeBrowserAuthTokenFlow,
    readBrowserAuthTokenFlowToken: mocks.readBrowserAuthTokenFlowToken,
  }),
);

vi.mock(
  '../src/services/login-throttle.service',
  (): {
    clearSuccessfulLoginThrottle: Mock<ClearSuccessfulLoginThrottle>;
    readLoginThrottleBlock: Mock<ReadLoginThrottleBlock>;
    recordFailedLoginAttempt: Mock<RecordFailedLoginAttempt>;
  } => ({
    clearSuccessfulLoginThrottle: mocks.clearSuccessfulLoginThrottle,
    readLoginThrottleBlock: mocks.readLoginThrottleBlock,
    recordFailedLoginAttempt: mocks.recordFailedLoginAttempt,
  }),
);

vi.mock(
  '../src/services/login.service',
  (): { login: Mock<Login>; loginForOrganization: Mock<LoginForOrganization> } => ({
    login: mocks.login,
    loginForOrganization: mocks.loginForOrganization,
  }),
);
vi.mock(
  '../src/services/organizations.service',
  (): OrganizationsServiceModuleMock => ({
    filterSessionVisibleOrganizations: mocks.filterSessionVisibleOrganizations,
    listSessionVisibleOrganizations: mocks.listSessionVisibleOrganizations,
    resolveOrganizationForPrincipal: mocks.resolveOrganizationForPrincipal,
  }),
);
vi.mock('../src/services/logout.service', (): { logout: Mock<Logout> } => ({
  logout: mocks.logout,
}));

vi.mock('../src/services/password-reset.service', (): { resetPassword: Mock<ResetPassword> } => ({
  resetPassword: mocks.resetPassword,
}));

vi.mock(
  '../src/services/reset-password-throttle.service',
  (): {
    clearSuccessfulResetPasswordThrottle: Mock<ClearSuccessfulResetPasswordThrottle>;
    readResetPasswordThrottleBlock: Mock<ReadResetPasswordThrottleBlock>;
    recordFailedResetPasswordAttempt: Mock<RecordFailedResetPasswordAttempt>;
  } => ({
    clearSuccessfulResetPasswordThrottle: mocks.clearSuccessfulResetPasswordThrottle,
    readResetPasswordThrottleBlock: mocks.readResetPasswordThrottleBlock,
    recordFailedResetPasswordAttempt: mocks.recordFailedResetPasswordAttempt,
  }),
);

describe('api auth activation routes', (): void => {
  beforeEach((): void => {
    mocks.clearSuccessfulActivationThrottle.mockResolvedValue();
    mocks.clearSuccessfulLoginThrottle.mockResolvedValue();
    mocks.clearSuccessfulResetPasswordThrottle.mockResolvedValue();
    mocks.consumeBrowserAuthTokenFlow.mockResolvedValue();
    mocks.requireInstalledCompartment.mockResolvedValue();
    mocks.readActivationThrottleBlock.mockResolvedValue(null);
    mocks.readBrowserAuthTokenFlowToken.mockImplementation(
      async (kind: 'activation' | 'password_reset', flowId: string | undefined): Promise<string | undefined> =>
        await Promise.resolve(kind === 'activation' && flowId === 'activation-flow' ? 'bootstrap-token' : undefined),
    );
    mocks.readLoginThrottleBlock.mockResolvedValue(null);
    mocks.readResetPasswordThrottleBlock.mockResolvedValue(null);
    mocks.recordFailedActivationAttempt.mockResolvedValue();
    mocks.recordFailedLoginAttempt.mockResolvedValue();
    mocks.recordFailedResetPasswordAttempt.mockResolvedValue();
    mockFilterSessionVisibleOrganizationsPassthrough(mocks.filterSessionVisibleOrganizations);
  });

  afterEach((): void => {
    mocks.clearSuccessfulActivationThrottle.mockReset();
    mocks.clearSuccessfulLoginThrottle.mockReset();
    mocks.clearSuccessfulResetPasswordThrottle.mockReset();
    mocks.activateLocalUser.mockReset();
    mocks.authenticateBrowserCompartmentSession.mockReset();
    mocks.authenticateSession.mockReset();
    mocks.canIssueAppAccessRedirect.mockReset();
    mocks.consumeBrowserAuthTokenFlow.mockReset();
    mocks.filterSessionVisibleOrganizations.mockReset();
    mocks.listSessionVisibleOrganizations.mockReset();
    mocks.login.mockReset();
    mocks.loginForOrganization.mockReset();
    mocks.logout.mockReset();
    mocks.readActivationThrottleBlock.mockReset();
    mocks.readBrowserAuthTokenFlowToken.mockReset();
    mocks.readLoginThrottleBlock.mockReset();
    mocks.readResetPasswordThrottleBlock.mockReset();
    mocks.recordFailedActivationAttempt.mockReset();
    mocks.recordFailedLoginAttempt.mockReset();
    mocks.recordFailedResetPasswordAttempt.mockReset();
    mocks.resolveOrganizationForPrincipal.mockReset();
    mocks.resetPassword.mockReset();
    mocks.requireInstalledCompartment.mockReset();
  });

  it('maps the activation service result to the v1 auth activate response payload', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.activateLocalUser.mockResolvedValueOnce(createPasswordSessionServiceResult());
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectJson(app, {
        method: 'POST',
        payload: {
          bootstrapToken: 'bootstrap-token',
          email: 'viewer@example.com',
          password: 'viewersecretpassword',
        },
        url: authApiActivatePathname,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        organizations: [
          {
            id: 'org_123',
            name: 'Acme Dev',
            slug: 'acme-dev',
          },
        ],
        principal: {
          email: 'viewer@example.com',
          id: 'prn_456',
          type: 'user',
        },
        sessionToken: 'viewer-session-token',
      });
      expect(mocks.activateLocalUser).toHaveBeenCalledWith({
        bootstrapToken: 'bootstrap-token',
        email: 'viewer@example.com',
        password: 'viewersecretpassword',
      });
    });
  });

  it('keeps the activation success response when clearing throttle state fails', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.activateLocalUser.mockResolvedValueOnce(createPasswordSessionServiceResult());
    mocks.clearSuccessfulActivationThrottle.mockRejectedValueOnce(new Error('throttle store unavailable'));
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectJson(app, {
        method: 'POST',
        payload: {
          bootstrapToken: 'bootstrap-token',
          email: 'viewer@example.com',
          password: 'viewersecretpassword',
        },
        url: authApiActivatePathname,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        organizations: [
          {
            id: 'org_123',
            name: 'Acme Dev',
            slug: 'acme-dev',
          },
        ],
        principal: {
          email: 'viewer@example.com',
          id: 'prn_456',
          type: 'user',
        },
        sessionToken: 'viewer-session-token',
      });
    });
  });

  it('keeps the invalid bootstrap token response when recording throttle state fails', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.activateLocalUser.mockRejectedValueOnce(createInvalidBootstrapTokenError());
    mocks.recordFailedActivationAttempt.mockRejectedValueOnce(new Error('throttle store unavailable'));
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectJson(app, {
        method: 'POST',
        payload: {
          bootstrapToken: 'wrong-bootstrap-token',
          email: 'viewer@example.com',
          password: 'viewersecretpassword',
        },
        url: authApiActivatePathname,
      });

      expectJsonError(response, 401, 'invalid_bootstrap_token');
      expect(mocks.recordFailedActivationAttempt).toHaveBeenCalledTimes(1);
    });
  });

  it('rejects v1 auth activation before installation', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.requireInstalledCompartment.mockRejectedValueOnce(createNotInstalledError());
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectJson(app, {
        method: 'POST',
        payload: {
          bootstrapToken: 'bootstrap-token',
          email: 'viewer@example.com',
          password: 'viewersecretpassword',
        },
        url: authApiActivatePathname,
      });

      expectJsonError(response, 409, 'not_installed');
      expect(mocks.activateLocalUser).not.toHaveBeenCalled();
    });
  });

  it('rate limits repeated v1 auth activation requests', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.activateLocalUser.mockResolvedValue(createPasswordSessionServiceResult());
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      for (let attempt: number = 0; attempt < authApiActivationRouteBudget; attempt += 1) {
        const response: LightMyRequestResponse = await injectJson(app, {
          method: 'POST',
          payload: {
            bootstrapToken: 'bootstrap-token',
            email: 'viewer@example.com',
            password: 'viewersecretpassword',
          },
          url: authApiActivatePathname,
        });

        expect(response.statusCode).toBe(200);
      }

      const limitedResponse: LightMyRequestResponse = await injectJson(app, {
        method: 'POST',
        payload: {
          bootstrapToken: 'bootstrap-token',
          email: 'viewer@example.com',
          password: 'viewersecretpassword',
        },
        url: authApiActivatePathname,
      });

      expectJsonError(limitedResponse, 429, 'api_rate_limit_exceeded');
      expect(mocks.activateLocalUser).toHaveBeenCalledTimes(authApiActivationRouteBudget);
    });
  });

  it('lets another activation email proceed from the same forwarded IP after one email spends its activation budget', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.activateLocalUser.mockResolvedValue(createPasswordSessionServiceResult());
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      for (let attempt: number = 0; attempt < authApiActivationRouteBudget; attempt += 1) {
        const response: LightMyRequestResponse = await injectJson(app, {
          headers: {
            'x-forwarded-for': '203.0.113.10',
          },
          method: 'POST',
          payload: {
            bootstrapToken: 'bootstrap-token',
            email: 'viewer@example.com',
            password: 'viewersecretpassword',
          },
          url: authApiActivatePathname,
        });

        expect(response.statusCode).toBe(200);
      }

      const victimResponse: LightMyRequestResponse = await injectJson(app, {
        headers: {
          'x-forwarded-for': '203.0.113.10',
        },
        method: 'POST',
        payload: {
          bootstrapToken: 'bootstrap-token',
          email: 'teammate@example.com',
          password: 'viewersecretpassword',
        },
        url: authApiActivatePathname,
      });

      expect(victimResponse.statusCode).toBe(200);
      expect(mocks.activateLocalUser).toHaveBeenCalledTimes(authApiActivationRouteBudget + 1);
    });
  });

  it('uses a configured non-default activation route budget', async (): Promise<void> => {
    applyApiRouteTestEnv({
      throttleAuthActivationRouteMaxRequests: 1,
    });
    mocks.activateLocalUser.mockResolvedValue(createPasswordSessionServiceResult());

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const firstResponse: LightMyRequestResponse = await injectJson(app, {
        method: 'POST',
        payload: {
          bootstrapToken: 'bootstrap-token',
          email: 'viewer@example.com',
          password: 'viewersecretpassword',
        },
        url: authApiActivatePathname,
      });

      expect(firstResponse.statusCode).toBe(200);

      const limitedResponse: LightMyRequestResponse = await injectJson(app, {
        method: 'POST',
        payload: {
          bootstrapToken: 'bootstrap-token',
          email: 'viewer@example.com',
          password: 'viewersecretpassword',
        },
        url: authApiActivatePathname,
      });

      expectJsonError(limitedResponse, 429, 'api_rate_limit_exceeded');
      expect(mocks.activateLocalUser).toHaveBeenCalledTimes(1);
    });
  });

  it('returns an activation cooldown response with Retry-After when the persistent throttle blocks the request', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.readActivationThrottleBlock.mockResolvedValueOnce({ retryAfterSeconds: 90 });

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectJson(app, {
        headers: {
          'x-forwarded-for': '203.0.113.20',
        },
        method: 'POST',
        payload: {
          bootstrapToken: 'bootstrap-token',
          email: 'viewer@example.com',
          password: 'viewersecretpassword',
        },
        url: authApiActivatePathname,
      });

      expectJsonError(response, 429, 'activation_rate_limit_exceeded');
      expect(response.headers['retry-after']).toBe('90');
      expect(mocks.activateLocalUser).not.toHaveBeenCalled();
    });
  });

  it('uses the browser activation token cookie for cookie-delivered activation', async (): Promise<void> => {
    applyApiRouteTestEnv({
      publicHttpPort: 80,
    });
    mocks.activateLocalUser.mockResolvedValueOnce(createPasswordSessionServiceResult());
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const csrfToken: string = await readBrowserCsrfToken(app, browserActivatePathname);
      const response: LightMyRequestResponse = await injectJson(app, {
        headers: buildBrowserCookieRequestHeaders({
          additionalCookie: '__Host-compartment_activate_flow=activation-flow',
          csrfToken,
          host: 'console.localhost',
          origin: 'http://console.localhost',
        }),
        method: 'POST',
        payload: {
          email: 'viewer@example.com',
          password: 'viewersecretpassword',
          sessionDelivery: 'cookie',
        },
        url: authApiActivatePathname,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        organizations: [
          {
            id: 'org_123',
            name: 'Acme Dev',
            slug: 'acme-dev',
          },
        ],
        principal: {
          email: 'viewer@example.com',
          id: 'prn_456',
          type: 'user',
        },
        redirectTo: '/orgs/acme-dev/projects',
      });
      expect(String(response.headers['set-cookie'])).toContain('__Host-compartment_activate_flow=;');
      expect(String(response.headers['set-cookie'])).toContain('__Host-compartment_activate_token=;');
      expect(String(response.headers['set-cookie'])).toContain(`${compartmentSessionCookieName}=viewer-session-token`);
      expect(mocks.activateLocalUser).toHaveBeenCalledWith({
        bootstrapToken: 'bootstrap-token',
        email: 'viewer@example.com',
        password: 'viewersecretpassword',
      });
      expect(mocks.consumeBrowserAuthTokenFlow).toHaveBeenCalledWith('activation', 'activation-flow');
    });
  });

  it('falls back to the console redirect when the activation flow target cannot enter the app flow', async (): Promise<void> => {
    applyApiRouteTestEnv({
      publicHttpPort: 80,
    });
    mocks.activateLocalUser.mockResolvedValueOnce(createPasswordSessionServiceResult());
    mocks.canIssueAppAccessRedirect.mockResolvedValueOnce(false);
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const csrfToken: string = await readBrowserCsrfToken(app, browserActivatePathname);
      const response: LightMyRequestResponse = await injectJson(app, {
        headers: buildBrowserCookieRequestHeaders({
          additionalCookie: '__Host-compartment_activate_flow=activation-flow',
          csrfToken,
          host: 'console.localhost',
          origin: 'http://console.localhost',
        }),
        method: 'POST',
        payload: {
          email: 'viewer@example.com',
          host: 'billing.localhost',
          password: 'viewersecretpassword',
          path: '/dashboard',
          sessionDelivery: 'cookie',
          state: 'flow',
        },
        url: authApiActivatePathname,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        organizations: [
          {
            id: 'org_123',
            name: 'Acme Dev',
            slug: 'acme-dev',
          },
        ],
        principal: {
          email: 'viewer@example.com',
          id: 'prn_456',
          type: 'user',
        },
        redirectTo: '/orgs/acme-dev/projects',
      });
      expect(String(response.headers['set-cookie'])).toContain('__Host-compartment_activate_flow=;');
      expect(String(response.headers['set-cookie'])).toContain('__Host-compartment_activate_token=;');
      expect(String(response.headers['set-cookie'])).toContain(`${compartmentSessionCookieName}=viewer-session-token`);
    });
  });

  it('rejects browser cookie activation form posts without a CSRF header', async (): Promise<void> => {
    applyApiRouteTestEnv({
      publicHttpPort: 80,
    });
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const csrfToken: string = await readBrowserCsrfToken(app, browserActivatePathname);
      const response: LightMyRequestResponse = await injectForm(app, {
        form: {
          email: 'viewer@example.com',
          password: 'viewersecretpassword',
          sessionDelivery: 'cookie',
        },
        headers: buildBrowserCookieRequestHeaders({
          additionalCookie: '__Host-compartment_activate_flow=activation-flow',
          csrfToken,
          host: 'console.localhost',
          includeCsrfHeader: false,
          origin: 'http://console.localhost',
        }),
        method: 'POST',
        url: authApiActivatePathname,
      });

      expectJsonError(response, 403, 'invalid_browser_request');
      expect(mocks.activateLocalUser).not.toHaveBeenCalled();
    });
  });

  it('rejects browser cookie activation on unsafe cross-origin requests', async (): Promise<void> => {
    applyApiRouteTestEnv({
      publicHttpPort: 80,
    });
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const csrfToken: string = await readBrowserCsrfToken(app, browserActivatePathname);
      const response: LightMyRequestResponse = await injectJson(app, {
        headers: buildBrowserCookieRequestHeaders({
          additionalCookie: '__Host-compartment_activate_flow=activation-flow',
          csrfToken,
          host: 'console.localhost',
          origin: 'http://evil.localhost',
        }),
        method: 'POST',
        payload: {
          email: 'viewer@example.com',
          password: 'viewersecretpassword',
          sessionDelivery: 'cookie',
        },
        url: authApiActivatePathname,
      });

      expectJsonError(response, 403, 'invalid_browser_request');
      expect(mocks.activateLocalUser).not.toHaveBeenCalled();
    });
  });

  it('does not redeem the browser activation cookie for token-delivered activation', async (): Promise<void> => {
    applyApiRouteTestEnv();
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectJson(app, {
        headers: {
          cookie: '__Host-compartment_activate_flow=activation-flow',
        },
        method: 'POST',
        payload: {
          email: 'viewer@example.com',
          password: 'viewersecretpassword',
        },
        url: authApiActivatePathname,
      });

      expectJsonError(response, 400, 'missing_activation_token');
      expect(mocks.activateLocalUser).not.toHaveBeenCalled();
      expect(mocks.readBrowserAuthTokenFlowToken).not.toHaveBeenCalled();
      expect(mocks.consumeBrowserAuthTokenFlow).not.toHaveBeenCalled();
    });
  });

  it('leaves the browser activation flow untouched for token-delivered activation', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.activateLocalUser.mockResolvedValueOnce(createPasswordSessionServiceResult());
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectJson(app, {
        headers: {
          cookie: '__Host-compartment_activate_flow=activation-flow',
        },
        method: 'POST',
        payload: {
          bootstrapToken: 'body-bootstrap-token',
          email: 'viewer@example.com',
          password: 'viewersecretpassword',
        },
        url: authApiActivatePathname,
      });

      expect(response.statusCode).toBe(200);
      expect(String(response.headers['set-cookie'])).not.toContain('__Host-compartment_activate_flow=;');
      expect(mocks.activateLocalUser).toHaveBeenCalledWith({
        bootstrapToken: 'body-bootstrap-token',
        email: 'viewer@example.com',
        password: 'viewersecretpassword',
      });
      expect(mocks.readBrowserAuthTokenFlowToken).not.toHaveBeenCalled();
      expect(mocks.consumeBrowserAuthTokenFlow).not.toHaveBeenCalled();
    });
  });

  it('leaves the browser activation flow untouched when cookie session delivery uses a body token', async (): Promise<void> => {
    applyApiRouteTestEnv({
      publicHttpPort: 80,
    });
    mocks.activateLocalUser.mockResolvedValueOnce(createPasswordSessionServiceResult());
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const csrfToken: string = await readBrowserCsrfToken(app, browserActivatePathname);
      const response: LightMyRequestResponse = await injectJson(app, {
        headers: buildBrowserCookieRequestHeaders({
          additionalCookie: '__Host-compartment_activate_flow=activation-flow',
          csrfToken,
          host: 'console.localhost',
          origin: 'http://console.localhost',
        }),
        method: 'POST',
        payload: {
          bootstrapToken: 'body-bootstrap-token',
          email: 'viewer@example.com',
          password: 'viewersecretpassword',
          sessionDelivery: 'cookie',
        },
        url: authApiActivatePathname,
      });

      expect(response.statusCode).toBe(200);
      expect(String(response.headers['set-cookie'])).toContain(`${compartmentSessionCookieName}=viewer-session-token`);
      expect(String(response.headers['set-cookie'])).not.toContain('__Host-compartment_activate_flow=;');
      expect(String(response.headers['set-cookie'])).toContain('__Host-compartment_activate_token=;');
      expect(mocks.activateLocalUser).toHaveBeenCalledWith({
        bootstrapToken: 'body-bootstrap-token',
        email: 'viewer@example.com',
        password: 'viewersecretpassword',
      });
      expect(mocks.readBrowserAuthTokenFlowToken).not.toHaveBeenCalled();
      expect(mocks.consumeBrowserAuthTokenFlow).not.toHaveBeenCalled();
    });
  });
});

function buildBrowserCookieRequestHeaders(options: BrowserCookieRequestHeadersOptions): Record<string, string> {
  const cookieParts: string[] = [];

  if (options.additionalCookie !== undefined) {
    cookieParts.push(options.additionalCookie);
  }
  if (options.sessionToken !== undefined) {
    cookieParts.push(`${compartmentSessionCookieName}=${options.sessionToken}`);
  }
  cookieParts.push(`${compartmentCsrfCookieName}=${options.csrfToken}`);

  const headers: Record<string, string> = {
    cookie: cookieParts.join('; '),
    host: options.host,
    origin: options.origin,
  };

  if (options.includeCsrfHeader ?? true) {
    headers[compartmentCsrfHeaderName] = options.csrfToken;
  }

  return headers;
}

async function readBrowserCsrfToken(app: ApiApp, url: string): Promise<string> {
  const response: LightMyRequestResponse = await injectApiRoute(app, {
    method: 'GET',
    url,
  });
  if (response.statusCode !== 200) {
    throw new Error(`Expected ${url} to return 200 before reading the CSRF cookie.`);
  }

  return requireSetCookieValue(response.headers['set-cookie'], compartmentCsrfCookieName);
}

function createPasswordSessionServiceResult(): ActivateLocalUserResult {
  return {
    authSession: {
      authMethodKind: 'password',
      oidcProviderId: null,
      organizationId: 'org_123',
      principalId: 'prn_456',
    },
    organizations: [
      {
        id: 'org_123',
        name: 'Acme Dev',
        slug: 'acme-dev',
      },
    ],
    principalEmail: 'viewer@example.com',
    principalId: 'prn_456',
    sessionExpiresAt: new Date('2099-03-31T00:00:00.000Z'),
    sessionId: 'ses_456',
    sessionToken: 'viewer-session-token',
  };
}
