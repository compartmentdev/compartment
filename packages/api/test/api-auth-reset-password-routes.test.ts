import {
  compartmentCsrfCookieName,
  compartmentCsrfHeaderName,
  compartmentSessionCookieName,
} from '@compartment/contracts';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ApiApp } from '../src/app.types';
import { browserLoginPathname, browserLogoutPathname, browserResetPasswordPathname } from '../src/browser-public-paths';
import { createInvalidPasswordResetTokenError } from '../src/errors/api-business-error';
import { authApiLogoutPathname, authApiResetPasswordPathname } from '../src/routes/auth/auth-api-paths';
import type { Actor } from '../src/services/auth-actor.types';
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
import { createBrowserCsrfCookie } from '../src/services/browser-csrf-cookie.service';
import {
  applyApiRouteTestEnv,
  expectJsonError,
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
const authApiResetPasswordRouteBudget: number = defaultApiAuthThrottleConfig.resetPassword.route.maxRequests;

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

describe('api auth reset and logout routes', (): void => {
  beforeEach((): void => {
    mocks.clearSuccessfulActivationThrottle.mockResolvedValue();
    mocks.clearSuccessfulLoginThrottle.mockResolvedValue();
    mocks.clearSuccessfulResetPasswordThrottle.mockResolvedValue();
    mocks.consumeBrowserAuthTokenFlow.mockResolvedValue();
    mocks.requireInstalledCompartment.mockResolvedValue();
    mocks.readActivationThrottleBlock.mockResolvedValue(null);
    mocks.readBrowserAuthTokenFlowToken.mockImplementation(
      async (kind: 'activation' | 'password_reset', flowId: string | undefined): Promise<string | undefined> =>
        await Promise.resolve(kind === 'password_reset' && flowId === 'reset-flow' ? 'reset-token' : undefined),
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

  it('maps the password reset service result to the v1 auth reset password response payload', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.resetPassword.mockResolvedValueOnce(createPasswordSessionServiceResult());
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectJson(app, {
        method: 'POST',
        payload: {
          email: 'viewer@example.com',
          password: 'nextsecretpassword',
          resetToken: 'reset-token',
        },
        url: authApiResetPasswordPathname,
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
      expect(mocks.resetPassword).toHaveBeenCalledWith('viewer@example.com', 'nextsecretpassword', 'reset-token');
    });
  });

  it('keeps the password reset success response when clearing throttle state fails', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.resetPassword.mockResolvedValueOnce(createPasswordSessionServiceResult());
    mocks.clearSuccessfulResetPasswordThrottle.mockRejectedValueOnce(new Error('throttle store unavailable'));
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectJson(app, {
        method: 'POST',
        payload: {
          email: 'viewer@example.com',
          password: 'nextsecretpassword',
          resetToken: 'reset-token',
        },
        url: authApiResetPasswordPathname,
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

  it('rejects an invalid reset password request before calling the reset service', async (): Promise<void> => {
    applyApiRouteTestEnv();
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectJson(app, {
        method: 'POST',
        payload: {
          email: 'viewer@example.com',
        },
        url: authApiResetPasswordPathname,
      });

      expectJsonError(response, 400, 'invalid_reset_password_request');
      expect(mocks.resetPassword).not.toHaveBeenCalled();
      expect(mocks.recordFailedResetPasswordAttempt).not.toHaveBeenCalled();
    });
  });

  it('rate limits repeated v1 auth reset password requests', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.resetPassword.mockResolvedValue(createPasswordSessionServiceResult());
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      for (let attempt: number = 0; attempt < authApiResetPasswordRouteBudget; attempt += 1) {
        const response: LightMyRequestResponse = await injectJson(app, {
          method: 'POST',
          payload: {
            email: 'viewer@example.com',
            password: 'nextsecretpassword',
            resetToken: 'reset-token',
          },
          url: authApiResetPasswordPathname,
        });

        expect(response.statusCode).toBe(200);
      }

      const limitedResponse: LightMyRequestResponse = await injectJson(app, {
        method: 'POST',
        payload: {
          email: 'viewer@example.com',
          password: 'nextsecretpassword',
          resetToken: 'reset-token',
        },
        url: authApiResetPasswordPathname,
      });

      expectJsonError(limitedResponse, 429, 'api_rate_limit_exceeded');
      expect(mocks.resetPassword).toHaveBeenCalledTimes(authApiResetPasswordRouteBudget);
    });
  });

  it('rate limits reset password requests across different flow target hosts for the same email', async (): Promise<void> => {
    applyApiRouteTestEnv({
      throttleAuthResetPasswordRouteMaxRequests: 1,
    });
    mocks.resetPassword.mockResolvedValue(createPasswordSessionServiceResult());
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const firstResponse: LightMyRequestResponse = await injectJson(app, {
        method: 'POST',
        payload: {
          email: 'viewer@example.com',
          host: 'billing.apps.localhost',
          path: '/dashboard',
          password: 'nextsecretpassword',
          resetToken: 'reset-token',
          state: 'flow',
        },
        url: authApiResetPasswordPathname,
      });
      const limitedResponse: LightMyRequestResponse = await injectJson(app, {
        method: 'POST',
        payload: {
          email: 'viewer@example.com',
          host: 'console.apps.localhost',
          path: '/dashboard',
          password: 'nextsecretpassword',
          resetToken: 'reset-token',
          state: 'flow',
        },
        url: authApiResetPasswordPathname,
      });

      expect(firstResponse.statusCode).toBe(200);
      expectJsonError(limitedResponse, 429, 'api_rate_limit_exceeded');
      expect(mocks.resetPassword).toHaveBeenCalledTimes(1);
    });
  });

  it('uses a configured non-default reset password route budget', async (): Promise<void> => {
    applyApiRouteTestEnv({
      throttleAuthResetPasswordRouteMaxRequests: 2,
    });
    mocks.resetPassword.mockResolvedValue(createPasswordSessionServiceResult());
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      for (let attempt: number = 0; attempt < 2; attempt += 1) {
        const response: LightMyRequestResponse = await injectJson(app, {
          method: 'POST',
          payload: {
            email: 'viewer@example.com',
            password: 'nextsecretpassword',
            resetToken: 'reset-token',
          },
          url: authApiResetPasswordPathname,
        });

        expect(response.statusCode).toBe(200);
      }

      const limitedResponse: LightMyRequestResponse = await injectJson(app, {
        method: 'POST',
        payload: {
          email: 'viewer@example.com',
          password: 'nextsecretpassword',
          resetToken: 'reset-token',
        },
        url: authApiResetPasswordPathname,
      });

      expectJsonError(limitedResponse, 429, 'api_rate_limit_exceeded');
      expect(mocks.resetPassword).toHaveBeenCalledTimes(2);
    });
  });

  it('returns a reset password cooldown response with Retry-After when the persistent throttle blocks the request', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.readResetPasswordThrottleBlock.mockResolvedValueOnce({ retryAfterSeconds: 42 });
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectJson(app, {
        headers: {
          'x-forwarded-for': '203.0.113.10',
        },
        method: 'POST',
        payload: {
          email: 'viewer@example.com',
          password: 'nextsecretpassword',
          resetToken: 'reset-token',
        },
        url: authApiResetPasswordPathname,
      });

      expectJsonError(response, 429, 'reset_password_rate_limit_exceeded');
      expect(response.headers['retry-after']).toBe('42');
      expect(mocks.resetPassword).not.toHaveBeenCalled();
    });
  });

  it('uses the browser reset password token cookie for cookie-delivered reset', async (): Promise<void> => {
    applyApiRouteTestEnv({
      publicHttpPort: 80,
    });
    mocks.resetPassword.mockResolvedValueOnce(createPasswordSessionServiceResult());
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const csrfToken: string = await readBrowserCsrfToken(app, browserResetPasswordPathname);
      const response: LightMyRequestResponse = await injectJson(app, {
        headers: buildBrowserCookieRequestHeaders({
          additionalCookie: '__Host-compartment_credential_reset_flow=reset-flow',
          csrfToken,
          host: 'console.localhost',
          origin: 'http://console.localhost',
        }),
        method: 'POST',
        payload: {
          email: 'viewer@example.com',
          password: 'nextsecretpassword',
          sessionDelivery: 'cookie',
        },
        url: authApiResetPasswordPathname,
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
        redirectTo: '/',
      });
      expect(String(response.headers['set-cookie'])).toContain('__Host-compartment_credential_reset_flow=;');
      expect(String(response.headers['set-cookie'])).toContain('__Host-compartment_pwd_reset_token=;');
      expect(String(response.headers['set-cookie'])).toContain('Path=/');
      expect(String(response.headers['set-cookie'])).toContain(`${compartmentSessionCookieName}=viewer-session-token`);
      expect(mocks.resetPassword).toHaveBeenCalledWith('viewer@example.com', 'nextsecretpassword', 'reset-token');
      expect(mocks.consumeBrowserAuthTokenFlow).toHaveBeenCalledWith('password_reset', 'reset-flow');
    });
  });

  it('rejects browser cookie reset password requests without a CSRF header', async (): Promise<void> => {
    applyApiRouteTestEnv({
      publicHttpPort: 80,
    });
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const csrfToken: string = await readBrowserCsrfToken(app, browserResetPasswordPathname);
      const response: LightMyRequestResponse = await injectJson(app, {
        headers: buildBrowserCookieRequestHeaders({
          additionalCookie: '__Host-compartment_credential_reset_flow=reset-flow',
          csrfToken,
          host: 'console.localhost',
          includeCsrfHeader: false,
          origin: 'http://console.localhost',
        }),
        method: 'POST',
        payload: {
          email: 'viewer@example.com',
          password: 'nextsecretpassword',
          sessionDelivery: 'cookie',
        },
        url: authApiResetPasswordPathname,
      });

      expectJsonError(response, 403, 'invalid_browser_request');
      expect(mocks.resetPassword).not.toHaveBeenCalled();
      expect(mocks.recordFailedResetPasswordAttempt).not.toHaveBeenCalled();
    });
  });

  it('falls back to the console redirect when the reset flow target cannot enter the app flow', async (): Promise<void> => {
    applyApiRouteTestEnv({
      publicHttpPort: 80,
    });
    mocks.resetPassword.mockResolvedValueOnce(createPasswordSessionServiceResult());
    mocks.canIssueAppAccessRedirect.mockResolvedValueOnce(false);
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const csrfToken: string = await readBrowserCsrfToken(app, browserResetPasswordPathname);
      const response: LightMyRequestResponse = await injectJson(app, {
        headers: buildBrowserCookieRequestHeaders({
          additionalCookie: '__Host-compartment_credential_reset_flow=reset-flow',
          csrfToken,
          host: 'console.localhost',
          origin: 'http://console.localhost',
        }),
        method: 'POST',
        payload: {
          email: 'viewer@example.com',
          host: 'billing.localhost',
          password: 'nextsecretpassword',
          path: '/dashboard',
          sessionDelivery: 'cookie',
          state: 'flow',
        },
        url: authApiResetPasswordPathname,
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
        redirectTo: '/',
      });
    });
  });

  it('rejects invalid reset browser flow before redeeming the reset token', async (): Promise<void> => {
    applyApiRouteTestEnv({
      publicHttpPort: 80,
    });
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const csrfToken: string = await readBrowserCsrfToken(app, browserResetPasswordPathname);
      const response: LightMyRequestResponse = await injectJson(app, {
        headers: buildBrowserCookieRequestHeaders({
          additionalCookie: '__Host-compartment_credential_reset_flow=reset-flow',
          csrfToken,
          host: 'console.localhost',
          origin: 'http://console.localhost',
        }),
        method: 'POST',
        payload: {
          email: 'viewer@example.com',
          host: 'billing.localhost',
          password: 'nextsecretpassword',
          sessionDelivery: 'cookie',
          state: 'flow',
        },
        url: authApiResetPasswordPathname,
      });

      expectJsonError(response, 400, 'invalid_browser_flow');
      expect(mocks.resetPassword).not.toHaveBeenCalled();
      expect(mocks.recordFailedResetPasswordAttempt).not.toHaveBeenCalled();
    });
  });

  it('clears the browser reset password token cookie when reset fails with an invalid token', async (): Promise<void> => {
    applyApiRouteTestEnv({
      publicHttpPort: 80,
    });
    mocks.resetPassword.mockRejectedValueOnce(createInvalidPasswordResetTokenError());
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const csrfToken: string = await readBrowserCsrfToken(app, browserResetPasswordPathname);
      const response: LightMyRequestResponse = await injectJson(app, {
        headers: buildBrowserCookieRequestHeaders({
          additionalCookie: '__Host-compartment_credential_reset_flow=reset-flow',
          csrfToken,
          host: 'console.localhost',
          origin: 'http://console.localhost',
        }),
        method: 'POST',
        payload: {
          email: 'viewer@example.com',
          password: 'nextsecretpassword',
          sessionDelivery: 'cookie',
        },
        url: authApiResetPasswordPathname,
      });

      expectJsonError(response, 401, 'invalid_password_reset_token');
      expect(String(response.headers['set-cookie'])).toContain('__Host-compartment_credential_reset_flow=;');
      expect(String(response.headers['set-cookie'])).toContain('__Host-compartment_pwd_reset_token=;');
      expect(String(response.headers['set-cookie'])).toContain('Path=/');
    });
  });

  it('keeps the invalid reset token response when recording throttle state fails', async (): Promise<void> => {
    applyApiRouteTestEnv({
      publicHttpPort: 80,
    });
    mocks.resetPassword.mockRejectedValueOnce(createInvalidPasswordResetTokenError());
    mocks.recordFailedResetPasswordAttempt.mockRejectedValueOnce(new Error('throttle store unavailable'));
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const csrfToken: string = await readBrowserCsrfToken(app, browserResetPasswordPathname);
      const response: LightMyRequestResponse = await injectJson(app, {
        headers: buildBrowserCookieRequestHeaders({
          additionalCookie: '__Host-compartment_credential_reset_flow=reset-flow',
          csrfToken,
          host: 'console.localhost',
          origin: 'http://console.localhost',
        }),
        method: 'POST',
        payload: {
          email: 'viewer@example.com',
          password: 'nextsecretpassword',
          sessionDelivery: 'cookie',
        },
        url: authApiResetPasswordPathname,
      });

      expectJsonError(response, 401, 'invalid_password_reset_token');
      expect(String(response.headers['set-cookie'])).toContain('__Host-compartment_credential_reset_flow=;');
      expect(String(response.headers['set-cookie'])).toContain('__Host-compartment_pwd_reset_token=;');
    });
  });

  it('does not redeem the browser reset password cookie for token-delivered reset', async (): Promise<void> => {
    applyApiRouteTestEnv();
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectJson(app, {
        headers: {
          cookie: '__Host-compartment_credential_reset_flow=reset-flow',
        },
        method: 'POST',
        payload: {
          email: 'viewer@example.com',
          password: 'nextsecretpassword',
        },
        url: authApiResetPasswordPathname,
      });

      expectJsonError(response, 400, 'missing_password_reset_token');
      expect(mocks.resetPassword).not.toHaveBeenCalled();
      expect(mocks.recordFailedResetPasswordAttempt).not.toHaveBeenCalled();
      expect(mocks.readBrowserAuthTokenFlowToken).not.toHaveBeenCalled();
      expect(mocks.consumeBrowserAuthTokenFlow).not.toHaveBeenCalled();
    });
  });

  it('leaves the browser reset password flow untouched for token-delivered reset', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.resetPassword.mockResolvedValueOnce(createPasswordSessionServiceResult());
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectJson(app, {
        headers: {
          cookie: '__Host-compartment_credential_reset_flow=reset-flow',
        },
        method: 'POST',
        payload: {
          email: 'viewer@example.com',
          password: 'nextsecretpassword',
          resetToken: 'body-reset-token',
        },
        url: authApiResetPasswordPathname,
      });

      expect(response.statusCode).toBe(200);
      expect(String(response.headers['set-cookie'])).not.toContain('__Host-compartment_credential_reset_flow=;');
      expect(mocks.resetPassword).toHaveBeenCalledWith('viewer@example.com', 'nextsecretpassword', 'body-reset-token');
      expect(mocks.readBrowserAuthTokenFlowToken).not.toHaveBeenCalled();
      expect(mocks.consumeBrowserAuthTokenFlow).not.toHaveBeenCalled();
    });
  });

  it('leaves the browser reset password flow untouched when cookie session delivery uses a body token', async (): Promise<void> => {
    applyApiRouteTestEnv({
      publicHttpPort: 80,
    });
    mocks.resetPassword.mockResolvedValueOnce(createPasswordSessionServiceResult());
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const csrfToken: string = await readBrowserCsrfToken(app, browserResetPasswordPathname);
      const response: LightMyRequestResponse = await injectJson(app, {
        headers: buildBrowserCookieRequestHeaders({
          additionalCookie: '__Host-compartment_credential_reset_flow=reset-flow',
          csrfToken,
          host: 'console.localhost',
          origin: 'http://console.localhost',
        }),
        method: 'POST',
        payload: {
          email: 'viewer@example.com',
          password: 'nextsecretpassword',
          resetToken: 'body-reset-token',
          sessionDelivery: 'cookie',
        },
        url: authApiResetPasswordPathname,
      });

      expect(response.statusCode).toBe(200);
      expect(String(response.headers['set-cookie'])).toContain(`${compartmentSessionCookieName}=viewer-session-token`);
      expect(String(response.headers['set-cookie'])).not.toContain('__Host-compartment_credential_reset_flow=;');
      expect(String(response.headers['set-cookie'])).toContain('__Host-compartment_pwd_reset_token=;');
      expect(mocks.resetPassword).toHaveBeenCalledWith('viewer@example.com', 'nextsecretpassword', 'body-reset-token');
      expect(mocks.readBrowserAuthTokenFlowToken).not.toHaveBeenCalled();
      expect(mocks.consumeBrowserAuthTokenFlow).not.toHaveBeenCalled();
    });
  });

  it('logs out browser cookie auth when same-origin CSRF checks pass', async (): Promise<void> => {
    applyApiRouteTestEnv({
      publicHttpPort: 80,
    });
    const actor: Actor = createActor();
    mocks.authenticateSession.mockResolvedValueOnce(actor);
    mocks.logout.mockResolvedValueOnce();
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const csrfToken: string = requireSetCookieValue(createBrowserCsrfCookie(), compartmentCsrfCookieName);
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        headers: buildBrowserCookieRequestHeaders({
          csrfToken,
          host: 'console.localhost',
          origin: 'http://console.localhost',
          sessionToken: 'session-token',
        }),
        method: 'POST',
        url: authApiLogoutPathname,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ success: true });
      expect(response.headers['set-cookie']).toContain(`${compartmentSessionCookieName}=`);
      expect(mocks.logout).toHaveBeenCalledWith(actor);
    });
  });

  it('accepts the configured public HTTPS origin behind issuer-managed TLS', async (): Promise<void> => {
    applyApiRouteTestEnv({
      baseDomain: 'example.com',
      publicHttpsPort: 443,
      publicProtocol: 'https',
    });
    const actor: Actor = createActor();
    mocks.authenticateSession.mockResolvedValueOnce(actor);
    mocks.logout.mockResolvedValueOnce();
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const csrfToken: string = requireSetCookieValue(createBrowserCsrfCookie(), compartmentCsrfCookieName);
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        headers: buildBrowserCookieRequestHeaders({
          csrfToken,
          host: 'console.example.com',
          origin: 'https://console.example.com',
          sessionToken: 'session-token',
        }),
        method: 'POST',
        url: authApiLogoutPathname,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ success: true });
      expect(mocks.logout).toHaveBeenCalledWith(actor);
    });
  });

  it('keeps public browser logout links non-mutating', async (): Promise<void> => {
    applyApiRouteTestEnv();
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        headers: {
          cookie: `${compartmentSessionCookieName}=session-token`,
        },
        method: 'GET',
        url: browserLogoutPathname,
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe(`${browserLoginPathname}?autoRedirect=false`);
      expect(response.headers['set-cookie']).toBeUndefined();
    });
  });

  it('rejects browser cookie auth on unsafe requests without a CSRF header', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.authenticateSession.mockResolvedValueOnce(createActor());
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        headers: buildBrowserCookieRequestHeaders({
          csrfToken: 'csrf-token',
          host: 'console.localhost',
          includeCsrfHeader: false,
          origin: 'http://console.localhost',
          sessionToken: 'session-token',
        }),
        method: 'POST',
        url: authApiLogoutPathname,
      });

      expectJsonError(response, 403, 'invalid_browser_request');
      expect(mocks.logout).not.toHaveBeenCalled();
    });
  });

  it('rejects browser cookie auth on unsafe cross-origin requests', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.authenticateSession.mockResolvedValueOnce(createActor());
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const csrfToken: string = requireSetCookieValue(createBrowserCsrfCookie(), compartmentCsrfCookieName);
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        headers: buildBrowserCookieRequestHeaders({
          csrfToken,
          host: 'console.localhost',
          origin: 'http://evil.localhost',
          sessionToken: 'session-token',
        }),
        method: 'POST',
        url: authApiLogoutPathname,
      });

      expectJsonError(response, 403, 'invalid_browser_request');
      expect(mocks.logout).not.toHaveBeenCalled();
    });
  });

  it('uses bearer transport when both bearer and browser cookies are present', async (): Promise<void> => {
    applyApiRouteTestEnv();
    const actor: Actor = createActor();
    mocks.authenticateSession.mockResolvedValueOnce(actor);
    mocks.logout.mockResolvedValueOnce();
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        headers: {
          authorization: 'Bearer bearer-session-token',
          cookie: `${compartmentSessionCookieName}=cookie-session-token`,
        },
        method: 'POST',
        url: authApiLogoutPathname,
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(mocks.authenticateSession).toHaveBeenCalledWith('bearer-session-token');
      expect(mocks.logout).toHaveBeenCalledWith(actor);
    });
  });

  it('returns unauthorized from the protected v1 auth logout route when the session is invalid', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.authenticateSession.mockResolvedValueOnce(null);
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        headers: {
          authorization: 'Bearer session-token',
        },
        method: 'POST',
        url: authApiLogoutPathname,
      });

      expectJsonError(response, 401, 'unauthorized');
      expect(mocks.logout).not.toHaveBeenCalled();
    });
  });
});

function createActor(): Actor {
  return {
    authSession: {
      authMethodKind: 'password',
      oidcProviderId: null,
      organizationId: null,
      principalId: 'prn_123',
    },
    memberships: [],
    principalEmail: 'admin@example.com',
    principalId: 'prn_123',
    principalType: 'user',
    sessionId: 'ses_123',
    tokenHash: 'hashed-session-token',
  };
}

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
      organizationId: null,
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
