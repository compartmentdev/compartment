import {
  compartmentCliLoginAttemptCookieName,
  compartmentCsrfCookieName,
  compartmentCsrfHeaderName,
  compartmentSessionCookieName,
} from '@compartment/contracts';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ApiApp } from '../src/app.types';
import { browserLoginCliCompletedPathname, browserLoginPathname } from '../src/browser-public-paths';
import { createInvalidCredentialsError, createNotInstalledError } from '../src/errors/api-business-error';
import { authApiLoginPathname } from '../src/routes/auth/auth-api-paths';
import type {
  clearSuccessfulActivationThrottle,
  readActivationThrottleBlock,
  recordFailedActivationAttempt,
} from '../src/services/activation-throttle.service';
import type { activateLocalUser } from '../src/services/activation.service';
import type {
  authenticateBrowserCompartmentSession,
  canIssueAppAccessRedirect,
} from '../src/services/app-access.service';
import type { requireInstalledCompartment } from '../src/services/app-access-target.service';
import type { authenticateSession } from '../src/services/authentication.service';
import type {
  completeCliLoginAttemptFromBrowserSessionCookie,
  readActiveCliLoginSessionActor,
} from '../src/services/browser-cli-login-flow.service';
import type { resolveBrowserLoginOrganizationId } from '../src/services/browser-login-flow.service';
import type {
  clearSuccessfulLoginThrottle,
  readLoginThrottleBlock,
  recordFailedLoginAttempt,
} from '../src/services/login-throttle.service';
import type { login, loginForOrganization } from '../src/services/login.service';
import type {
  recordFailedLoginAuditEvent,
  recordSuccessfulLoginAuditEvents,
} from '../src/services/authentication-audit.service';
import type { LoginServiceResult } from '../src/services/login.service.types';
import type { logout } from '../src/services/logout.service';
import type { OrganizationRow } from '../src/queries/organizations.query.types';
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
import { expectNoStoreCacheControlHeader } from './response-cache-test.helpers';
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
type CompleteCliLoginAttemptFromBrowserSessionCookie = typeof completeCliLoginAttemptFromBrowserSessionCookie;
type Login = typeof login;
type LoginForOrganization = typeof loginForOrganization;
type Logout = typeof logout;
type ListSessionVisibleOrganizations = typeof listSessionVisibleOrganizations;
type ReadActiveCliLoginSessionActor = typeof readActiveCliLoginSessionActor;
type ReadActivationThrottleBlock = typeof readActivationThrottleBlock;
type ReadLoginThrottleBlock = typeof readLoginThrottleBlock;
type ReadResetPasswordThrottleBlock = typeof readResetPasswordThrottleBlock;
type RecordFailedActivationAttempt = typeof recordFailedActivationAttempt;
type RecordFailedLoginAttempt = typeof recordFailedLoginAttempt;
type RecordFailedLoginAuditEvent = typeof recordFailedLoginAuditEvent;
type RecordSuccessfulLoginAuditEvents = typeof recordSuccessfulLoginAuditEvents;
type RecordFailedResetPasswordAttempt = typeof recordFailedResetPasswordAttempt;
type ResetPassword = typeof resetPassword;
type ResolveOrganizationForPrincipal = typeof resolveOrganizationForPrincipal;
type ResolveBrowserLoginOrganizationId = typeof resolveBrowserLoginOrganizationId;
type RequireInstalledCompartment = typeof requireInstalledCompartment;

interface ApiAuthRouteMocks {
  clearSuccessfulActivationThrottle: Mock<ClearSuccessfulActivationThrottle>;
  clearSuccessfulLoginThrottle: Mock<ClearSuccessfulLoginThrottle>;
  clearSuccessfulResetPasswordThrottle: Mock<ClearSuccessfulResetPasswordThrottle>;
  activateLocalUser: Mock<ActivateLocalUser>;
  authenticateBrowserCompartmentSession: Mock<AuthenticateBrowserCompartmentSession>;
  authenticateSession: Mock<AuthenticateSession>;
  canIssueAppAccessRedirect: Mock<CanIssueAppAccessRedirect>;
  completeCliLoginAttemptFromBrowserSessionCookie: Mock<CompleteCliLoginAttemptFromBrowserSessionCookie>;
  filterSessionVisibleOrganizations: Mock<FilterSessionVisibleOrganizations>;
  listSessionVisibleOrganizations: Mock<ListSessionVisibleOrganizations>;
  login: Mock<Login>;
  loginForOrganization: Mock<LoginForOrganization>;
  logout: Mock<Logout>;
  readActiveCliLoginSessionActor: Mock<ReadActiveCliLoginSessionActor>;
  readActivationThrottleBlock: Mock<ReadActivationThrottleBlock>;
  readLoginThrottleBlock: Mock<ReadLoginThrottleBlock>;
  readResetPasswordThrottleBlock: Mock<ReadResetPasswordThrottleBlock>;
  recordFailedActivationAttempt: Mock<RecordFailedActivationAttempt>;
  recordFailedLoginAttempt: Mock<RecordFailedLoginAttempt>;
  recordFailedLoginAuditEvent: Mock<RecordFailedLoginAuditEvent>;
  recordSuccessfulLoginAuditEvents: Mock<RecordSuccessfulLoginAuditEvents>;
  recordFailedResetPasswordAttempt: Mock<RecordFailedResetPasswordAttempt>;
  resetPassword: Mock<ResetPassword>;
  resolveOrganizationForPrincipal: Mock<ResolveOrganizationForPrincipal>;
  resolveBrowserLoginOrganizationId: Mock<ResolveBrowserLoginOrganizationId>;
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

const authApiLoginRouteBudget: number = defaultApiAuthThrottleConfig.login.route.maxRequests;

const mocks: ApiAuthRouteMocks = vi.hoisted(
  (): ApiAuthRouteMocks => ({
    clearSuccessfulActivationThrottle: vi.fn<ClearSuccessfulActivationThrottle>(),
    clearSuccessfulLoginThrottle: vi.fn<ClearSuccessfulLoginThrottle>(),
    clearSuccessfulResetPasswordThrottle: vi.fn<ClearSuccessfulResetPasswordThrottle>(),
    activateLocalUser: vi.fn<ActivateLocalUser>(),
    authenticateBrowserCompartmentSession: vi.fn<AuthenticateBrowserCompartmentSession>(),
    authenticateSession: vi.fn<AuthenticateSession>(),
    canIssueAppAccessRedirect: vi.fn<CanIssueAppAccessRedirect>(),
    completeCliLoginAttemptFromBrowserSessionCookie: vi.fn<CompleteCliLoginAttemptFromBrowserSessionCookie>(),
    filterSessionVisibleOrganizations: vi.fn<FilterSessionVisibleOrganizations>(),
    listSessionVisibleOrganizations: vi.fn<ListSessionVisibleOrganizations>(),
    login: vi.fn<Login>(),
    loginForOrganization: vi.fn<LoginForOrganization>(),
    logout: vi.fn<Logout>(),
    readActiveCliLoginSessionActor: vi.fn<ReadActiveCliLoginSessionActor>(),
    readActivationThrottleBlock: vi.fn<ReadActivationThrottleBlock>(),
    readLoginThrottleBlock: vi.fn<ReadLoginThrottleBlock>(),
    readResetPasswordThrottleBlock: vi.fn<ReadResetPasswordThrottleBlock>(),
    recordFailedActivationAttempt: vi.fn<RecordFailedActivationAttempt>(),
    recordFailedLoginAttempt: vi.fn<RecordFailedLoginAttempt>(),
    recordFailedLoginAuditEvent: vi.fn<RecordFailedLoginAuditEvent>(),
    recordSuccessfulLoginAuditEvents: vi.fn<RecordSuccessfulLoginAuditEvents>(),
    recordFailedResetPasswordAttempt: vi.fn<RecordFailedResetPasswordAttempt>(),
    resetPassword: vi.fn<ResetPassword>(),
    resolveOrganizationForPrincipal: vi.fn<ResolveOrganizationForPrincipal>(),
    resolveBrowserLoginOrganizationId: vi.fn<ResolveBrowserLoginOrganizationId>(),
    requireInstalledCompartment: vi.fn<RequireInstalledCompartment>(),
  }),
);

vi.mock(
  '../src/services/authentication-audit.service',
  (): {
    recordFailedLoginAuditEvent: Mock<RecordFailedLoginAuditEvent>;
    recordSuccessfulLoginAuditEvents: Mock<RecordSuccessfulLoginAuditEvents>;
  } => ({
    recordFailedLoginAuditEvent: mocks.recordFailedLoginAuditEvent,
    recordSuccessfulLoginAuditEvents: mocks.recordSuccessfulLoginAuditEvents,
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
  '../src/services/browser-cli-login-flow.service',
  (): {
    completeCliLoginAttemptFromBrowserSessionCookie: Mock<CompleteCliLoginAttemptFromBrowserSessionCookie>;
    readActiveCliLoginSessionActor: Mock<ReadActiveCliLoginSessionActor>;
  } => ({
    completeCliLoginAttemptFromBrowserSessionCookie: mocks.completeCliLoginAttemptFromBrowserSessionCookie,
    readActiveCliLoginSessionActor: mocks.readActiveCliLoginSessionActor,
  }),
);

vi.mock(
  '../src/services/browser-login-flow.service',
  (): { resolveBrowserLoginOrganizationId: Mock<ResolveBrowserLoginOrganizationId> } => ({
    resolveBrowserLoginOrganizationId: mocks.resolveBrowserLoginOrganizationId,
  }),
);

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

describe('api auth login routes', (): void => {
  beforeEach((): void => {
    mocks.clearSuccessfulActivationThrottle.mockResolvedValue();
    mocks.clearSuccessfulLoginThrottle.mockResolvedValue();
    mocks.clearSuccessfulResetPasswordThrottle.mockResolvedValue();
    mocks.requireInstalledCompartment.mockResolvedValue();
    mocks.readActivationThrottleBlock.mockResolvedValue(null);
    mocks.readLoginThrottleBlock.mockResolvedValue(null);
    mocks.readResetPasswordThrottleBlock.mockResolvedValue(null);
    mocks.recordFailedActivationAttempt.mockResolvedValue();
    mocks.recordFailedLoginAttempt.mockResolvedValue();
    mocks.recordFailedLoginAuditEvent.mockResolvedValue();
    mocks.recordSuccessfulLoginAuditEvents.mockResolvedValue();
    mocks.recordFailedResetPasswordAttempt.mockResolvedValue();
    mocks.resolveBrowserLoginOrganizationId.mockResolvedValue('org_123');
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
    mocks.completeCliLoginAttemptFromBrowserSessionCookie.mockReset();
    mocks.filterSessionVisibleOrganizations.mockReset();
    mocks.listSessionVisibleOrganizations.mockReset();
    mocks.login.mockReset();
    mocks.loginForOrganization.mockReset();
    mocks.logout.mockReset();
    mocks.readActiveCliLoginSessionActor.mockReset();
    mocks.readActivationThrottleBlock.mockReset();
    mocks.readLoginThrottleBlock.mockReset();
    mocks.readResetPasswordThrottleBlock.mockReset();
    mocks.recordFailedActivationAttempt.mockReset();
    mocks.recordFailedLoginAttempt.mockReset();
    mocks.recordFailedLoginAuditEvent.mockReset();
    mocks.recordSuccessfulLoginAuditEvents.mockReset();
    mocks.recordFailedResetPasswordAttempt.mockReset();
    mocks.resetPassword.mockReset();
    mocks.resolveOrganizationForPrincipal.mockReset();
    mocks.resolveBrowserLoginOrganizationId.mockReset();
    mocks.requireInstalledCompartment.mockReset();
  });

  it('maps the login service result to the v1 auth login response payload', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.login.mockResolvedValueOnce(createLoginServiceResult());
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectJson(app, {
        method: 'POST',
        payload: {
          email: 'admin@example.com',
          password: 'supersecretpassword',
        },
        url: authApiLoginPathname,
      });

      expect(response.statusCode).toBe(200);
      expectNoStoreCacheControlHeader(response);
      expect(response.json()).toEqual({
        organizations: [
          {
            id: 'org_123',
            name: 'Acme Dev',
            slug: 'acme-dev',
          },
        ],
        principal: {
          email: 'admin@example.com',
          id: 'prn_123',
          type: 'user',
        },
        sessionToken: 'session-token',
      });
      expect(mocks.login).toHaveBeenCalledWith({
        email: 'admin@example.com',
        password: 'supersecretpassword',
      });
    });
  });

  it('keeps the login success response when clearing throttle state fails', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.login.mockResolvedValueOnce(createLoginServiceResult());
    mocks.clearSuccessfulLoginThrottle.mockRejectedValueOnce(new Error('throttle store unavailable'));
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectJson(app, {
        method: 'POST',
        payload: {
          email: 'admin@example.com',
          password: 'supersecretpassword',
        },
        url: authApiLoginPathname,
      });

      expect(response.statusCode).toBe(200);
      expectNoStoreCacheControlHeader(response);
      expect(response.json()).toEqual({
        organizations: [
          {
            id: 'org_123',
            name: 'Acme Dev',
            slug: 'acme-dev',
          },
        ],
        principal: {
          email: 'admin@example.com',
          id: 'prn_123',
          type: 'user',
        },
        sessionToken: 'session-token',
      });
    });
  });

  it('returns only session-visible organizations in token login responses', async (): Promise<void> => {
    applyApiRouteTestEnv();
    const serviceResult: LoginServiceResult = createLoginServiceResult([
      {
        id: 'org_123',
        name: 'Acme Dev',
        slug: 'acme-dev',
      },
      {
        id: 'org_456',
        name: 'Hidden Org',
        slug: 'hidden-org',
      },
    ]);
    mocks.login.mockResolvedValueOnce(serviceResult);
    mocks.filterSessionVisibleOrganizations.mockResolvedValueOnce(serviceResult.organizations.slice(0, 1));

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectJson(app, {
        method: 'POST',
        payload: {
          email: 'admin@example.com',
          password: 'supersecretpassword',
        },
        url: authApiLoginPathname,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        organizations: [
          {
            id: 'org_123',
            name: 'Acme Dev',
            slug: 'acme-dev',
          },
        ],
      });
      expect(mocks.filterSessionVisibleOrganizations).toHaveBeenCalledWith(
        serviceResult.organizations,
        serviceResult.authSession,
      );
    });
  });

  it('keeps the invalid credentials response when recording throttle state fails', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.login.mockRejectedValueOnce(createInvalidCredentialsError());
    mocks.recordFailedLoginAttempt.mockRejectedValueOnce(new Error('throttle store unavailable'));
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectJson(app, {
        method: 'POST',
        payload: {
          email: 'admin@example.com',
          password: 'wrong-password',
        },
        url: authApiLoginPathname,
      });

      expectJsonError(response, 401, 'invalid_credentials');
      expect(mocks.recordFailedLoginAttempt).toHaveBeenCalledTimes(1);
    });
  });

  it('rejects an invalid login request before calling the login service', async (): Promise<void> => {
    applyApiRouteTestEnv();
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectJson(app, {
        method: 'POST',
        payload: {
          email: 'admin@example.com',
        },
        url: authApiLoginPathname,
      });

      expectJsonError(response, 400, 'invalid_login_request');
      expect(mocks.login).not.toHaveBeenCalled();
    });
  });

  it('rejects v1 auth login before installation', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.requireInstalledCompartment.mockRejectedValueOnce(createNotInstalledError());
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectJson(app, {
        method: 'POST',
        payload: {
          email: 'admin@example.com',
          password: 'supersecretpassword',
        },
        url: authApiLoginPathname,
      });

      expectJsonError(response, 409, 'not_installed');
      expect(mocks.login).not.toHaveBeenCalled();
    });
  });

  it('rate limits repeated v1 auth login requests', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.login.mockResolvedValue(createLoginServiceResult());
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      for (let attempt: number = 0; attempt < authApiLoginRouteBudget; attempt += 1) {
        const response: LightMyRequestResponse = await injectJson(app, {
          method: 'POST',
          payload: {
            email: 'admin@example.com',
            password: 'supersecretpassword',
          },
          url: authApiLoginPathname,
        });

        expect(response.statusCode).toBe(200);
      }

      const limitedResponse: LightMyRequestResponse = await injectJson(app, {
        method: 'POST',
        payload: {
          email: 'admin@example.com',
          password: 'supersecretpassword',
        },
        url: authApiLoginPathname,
      });

      expectJsonError(limitedResponse, 429, 'api_rate_limit_exceeded');
      expect(mocks.login).toHaveBeenCalledTimes(authApiLoginRouteBudget);
    });
  });

  it('lets another email log in from the same forwarded IP after one email spends its login route budget', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.login.mockResolvedValue(createLoginServiceResult());

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      for (let attempt: number = 0; attempt < authApiLoginRouteBudget; attempt += 1) {
        const response: LightMyRequestResponse = await injectJson(app, {
          headers: {
            'x-forwarded-for': '203.0.113.10',
          },
          method: 'POST',
          payload: {
            email: 'attacker@example.com',
            password: 'supersecretpassword',
          },
          url: authApiLoginPathname,
        });

        expect(response.statusCode).toBe(200);
      }

      const victimResponse: LightMyRequestResponse = await injectJson(app, {
        headers: {
          'x-forwarded-for': '203.0.113.10',
        },
        method: 'POST',
        payload: {
          email: 'victim@example.com',
          password: 'supersecretpassword',
        },
        url: authApiLoginPathname,
      });

      expect(victimResponse.statusCode).toBe(200);
      expect(mocks.login).toHaveBeenCalledTimes(authApiLoginRouteBudget + 1);
    });
  });

  it('uses a configured non-default login route budget', async (): Promise<void> => {
    applyApiRouteTestEnv({
      throttleAuthLoginRouteMaxRequests: 2,
    });
    mocks.login.mockResolvedValue(createLoginServiceResult());

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      for (let attempt: number = 0; attempt < 2; attempt += 1) {
        const response: LightMyRequestResponse = await injectJson(app, {
          method: 'POST',
          payload: {
            email: 'admin@example.com',
            password: 'supersecretpassword',
          },
          url: authApiLoginPathname,
        });

        expect(response.statusCode).toBe(200);
      }

      const limitedResponse: LightMyRequestResponse = await injectJson(app, {
        method: 'POST',
        payload: {
          email: 'admin@example.com',
          password: 'supersecretpassword',
        },
        url: authApiLoginPathname,
      });

      expectJsonError(limitedResponse, 429, 'api_rate_limit_exceeded');
      expect(mocks.login).toHaveBeenCalledTimes(2);
    });
  });

  it('returns a login cooldown response with Retry-After when the persistent throttle blocks the request', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.readLoginThrottleBlock.mockResolvedValueOnce({ retryAfterSeconds: 42 });

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectJson(app, {
        headers: {
          'x-forwarded-for': '203.0.113.10',
        },
        method: 'POST',
        payload: {
          email: 'admin@example.com',
          password: 'supersecretpassword',
        },
        url: authApiLoginPathname,
      });

      expectJsonError(response, 429, 'login_rate_limit_exceeded');
      expect(response.headers['retry-after']).toBe('42');
      expect(mocks.login).not.toHaveBeenCalled();
    });
  });

  it('logs in browser cookie auth when same-origin CSRF checks pass', async (): Promise<void> => {
    applyApiRouteTestEnv({
      publicHttpPort: 80,
    });
    mocks.loginForOrganization.mockResolvedValueOnce(createLoginServiceResult());
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const csrfToken: string = await readBrowserCsrfToken(app, browserLoginPathname);
      const response: LightMyRequestResponse = await injectJson(app, {
        headers: buildBrowserCookieRequestHeaders({
          csrfToken,
          host: 'console.localhost',
          origin: 'http://console.localhost',
        }),
        method: 'POST',
        payload: {
          email: 'admin@example.com',
          password: 'supersecretpassword',
          sessionDelivery: 'cookie',
        },
        url: authApiLoginPathname,
      });

      expect(response.statusCode).toBe(200);
      expectNoStoreCacheControlHeader(response);
      expect(response.json()).toEqual({
        organizations: [
          {
            id: 'org_123',
            name: 'Acme Dev',
            slug: 'acme-dev',
          },
        ],
        principal: {
          email: 'admin@example.com',
          id: 'prn_123',
          type: 'user',
        },
        redirectTo: '/orgs/acme-dev/projects',
      });
      expect(response.headers['set-cookie']).toContain(`${compartmentSessionCookieName}=session-token`);
      expect(mocks.loginForOrganization).toHaveBeenCalledWith({
        email: 'admin@example.com',
        organizationId: 'org_123',
        password: 'supersecretpassword',
      });
    });
  });

  it('returns only session-visible organizations in browser cookie login responses', async (): Promise<void> => {
    applyApiRouteTestEnv({
      publicHttpPort: 80,
    });
    const serviceResult: LoginServiceResult = createLoginServiceResult([
      {
        id: 'org_123',
        name: 'Acme Dev',
        slug: 'acme-dev',
      },
      {
        id: 'org_456',
        name: 'Hidden Org',
        slug: 'hidden-org',
      },
    ]);
    mocks.loginForOrganization.mockResolvedValueOnce(serviceResult);
    mocks.filterSessionVisibleOrganizations.mockResolvedValueOnce(serviceResult.organizations.slice(0, 1));

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const csrfToken: string = await readBrowserCsrfToken(app, browserLoginPathname);
      const response: LightMyRequestResponse = await injectJson(app, {
        headers: buildBrowserCookieRequestHeaders({
          csrfToken,
          host: 'console.localhost',
          origin: 'http://console.localhost',
        }),
        method: 'POST',
        payload: {
          email: 'admin@example.com',
          password: 'supersecretpassword',
          sessionDelivery: 'cookie',
        },
        url: authApiLoginPathname,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        organizations: [
          {
            id: 'org_123',
            name: 'Acme Dev',
            slug: 'acme-dev',
          },
        ],
      });
      expect(mocks.filterSessionVisibleOrganizations).toHaveBeenCalledWith(
        serviceResult.organizations,
        serviceResult.authSession,
      );
    });
  });

  it('uses the selected organization id instead of the first visible organization for browser redirects', async (): Promise<void> => {
    applyApiRouteTestEnv({
      publicHttpPort: 80,
    });
    const serviceResult: LoginServiceResult = createLoginServiceResult(
      [createOrganizationRow(), createBetaOrganizationRow()],
      'org_456',
    );
    mocks.resolveBrowserLoginOrganizationId.mockResolvedValueOnce('org_456');
    mocks.loginForOrganization.mockResolvedValueOnce(serviceResult);

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const csrfToken: string = await readBrowserCsrfToken(app, browserLoginPathname);
      const response: LightMyRequestResponse = await injectJson(app, {
        headers: buildBrowserCookieRequestHeaders({
          csrfToken,
          host: 'console.localhost',
          origin: 'http://console.localhost',
        }),
        method: 'POST',
        payload: {
          email: 'admin@example.com',
          organizationSlug: 'beta-dev',
          password: 'supersecretpassword',
          sessionDelivery: 'cookie',
        },
        url: authApiLoginPathname,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        redirectTo: '/orgs/beta-dev/projects',
      });
      expect(mocks.loginForOrganization).toHaveBeenCalledWith({
        email: 'admin@example.com',
        organizationId: 'org_456',
        password: 'supersecretpassword',
      });
    });
  });

  it('rejects browser cookie login when the selected organization is not session-visible', async (): Promise<void> => {
    applyApiRouteTestEnv({
      publicHttpPort: 80,
    });
    const serviceResult: LoginServiceResult = createLoginServiceResult(
      [createOrganizationRow(), createBetaOrganizationRow()],
      'org_456',
    );
    mocks.resolveBrowserLoginOrganizationId.mockResolvedValueOnce('org_456');
    mocks.loginForOrganization.mockResolvedValueOnce(serviceResult);
    mocks.filterSessionVisibleOrganizations.mockResolvedValueOnce([createOrganizationRow()]);

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const csrfToken: string = await readBrowserCsrfToken(app, browserLoginPathname);
      const response: LightMyRequestResponse = await injectJson(app, {
        headers: buildBrowserCookieRequestHeaders({
          csrfToken,
          host: 'console.localhost',
          origin: 'http://console.localhost',
        }),
        method: 'POST',
        payload: {
          email: 'admin@example.com',
          organizationSlug: 'beta-dev',
          password: 'supersecretpassword',
          sessionDelivery: 'cookie',
        },
        url: authApiLoginPathname,
      });

      expectJsonError(response, 403, 'forbidden');
      expect(response.headers['set-cookie']).toBeUndefined();
    });
  });

  it('redirects cookie login back to the terminal when a CLI attempt completes', async (): Promise<void> => {
    applyApiRouteTestEnv({
      publicHttpPort: 80,
    });
    mocks.loginForOrganization.mockResolvedValueOnce(createLoginServiceResult());
    mocks.readActiveCliLoginSessionActor.mockResolvedValueOnce({
      authMethodKind: 'password',
      oidcProviderId: null,
      organizationId: 'org_123',
      principalEmail: 'admin@example.com',
      principalId: 'prn_123',
    });
    mocks.completeCliLoginAttemptFromBrowserSessionCookie.mockResolvedValueOnce('completed');

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const csrfToken: string = await readBrowserCsrfToken(app, browserLoginPathname);
      const response: LightMyRequestResponse = await injectJson(app, {
        headers: buildBrowserCookieRequestHeaders({
          additionalCookie: `${compartmentCliLoginAttemptCookieName}=cla_123:browser-code`,
          csrfToken,
          host: 'console.localhost',
          origin: 'http://console.localhost',
        }),
        method: 'POST',
        payload: {
          email: 'admin@example.com',
          password: 'supersecretpassword',
          sessionDelivery: 'cookie',
        },
        url: authApiLoginPathname,
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
          email: 'admin@example.com',
          id: 'prn_123',
          type: 'user',
        },
        redirectTo: browserLoginCliCompletedPathname,
      });
      expect(response.headers['set-cookie']).toEqual(
        expect.arrayContaining([
          expect.stringContaining(`${compartmentSessionCookieName}=session-token`),
          expect.stringContaining(`${compartmentCliLoginAttemptCookieName}=`),
        ]),
      );
    });
  });

  it('keeps cookie login on the browser login page when a CLI attempt belongs to a different principal', async (): Promise<void> => {
    applyApiRouteTestEnv({
      publicHttpPort: 80,
    });
    mocks.loginForOrganization.mockResolvedValueOnce(createLoginServiceResult());
    mocks.readActiveCliLoginSessionActor.mockResolvedValueOnce({
      authMethodKind: 'password',
      oidcProviderId: null,
      organizationId: 'org_123',
      principalEmail: 'admin@example.com',
      principalId: 'prn_123',
    });
    mocks.completeCliLoginAttemptFromBrowserSessionCookie.mockResolvedValueOnce('different_principal');

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const csrfToken: string = await readBrowserCsrfToken(app, browserLoginPathname);
      const response: LightMyRequestResponse = await injectJson(app, {
        headers: buildBrowserCookieRequestHeaders({
          additionalCookie: `${compartmentCliLoginAttemptCookieName}=cla_123:browser-code`,
          csrfToken,
          host: 'console.localhost',
          origin: 'http://console.localhost',
        }),
        method: 'POST',
        payload: {
          email: 'admin@example.com',
          password: 'supersecretpassword',
          sessionDelivery: 'cookie',
        },
        url: authApiLoginPathname,
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
          email: 'admin@example.com',
          id: 'prn_123',
          type: 'user',
        },
        redirectTo: `${browserLoginPathname}?autoRedirect=false`,
      });
      expect(response.headers['set-cookie']).toContain(`${compartmentSessionCookieName}=session-token`);
      expect(response.headers['set-cookie']).not.toEqual(
        expect.arrayContaining([expect.stringContaining(`${compartmentCliLoginAttemptCookieName}=`)]),
      );
    });
  });

  it('rejects browser cookie login form posts without a CSRF header', async (): Promise<void> => {
    applyApiRouteTestEnv({
      publicHttpPort: 80,
    });
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const csrfToken: string = await readBrowserCsrfToken(app, browserLoginPathname);
      const response: LightMyRequestResponse = await injectForm(app, {
        form: {
          email: 'admin@example.com',
          password: 'supersecretpassword',
          sessionDelivery: 'cookie',
        },
        headers: buildBrowserCookieRequestHeaders({
          csrfToken,
          host: 'console.localhost',
          includeCsrfHeader: false,
          origin: 'http://console.localhost',
        }),
        method: 'POST',
        url: authApiLoginPathname,
      });

      expectJsonError(response, 403, 'invalid_browser_request');
      expect(mocks.login).not.toHaveBeenCalled();
    });
  });

  it('rejects browser cookie login on unsafe cross-origin requests', async (): Promise<void> => {
    applyApiRouteTestEnv({
      publicHttpPort: 80,
    });
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const csrfToken: string = await readBrowserCsrfToken(app, browserLoginPathname);
      const response: LightMyRequestResponse = await injectJson(app, {
        headers: buildBrowserCookieRequestHeaders({
          csrfToken,
          host: 'console.localhost',
          origin: 'http://evil.localhost',
        }),
        method: 'POST',
        payload: {
          email: 'admin@example.com',
          password: 'supersecretpassword',
          sessionDelivery: 'cookie',
        },
        url: authApiLoginPathname,
      });

      expectJsonError(response, 403, 'invalid_browser_request');
      expect(mocks.login).not.toHaveBeenCalled();
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

function createLoginServiceResult(
  organizations: OrganizationRow[] = [createOrganizationRow()],
  organizationId: string = 'org_123',
): LoginServiceResult {
  return {
    authSession: {
      authMethodKind: 'password',
      oidcProviderId: null,
      organizationId,
      principalId: 'prn_123',
    },
    organizations,
    principalEmail: 'admin@example.com',
    principalId: 'prn_123',
    sessionExpiresAt: new Date('2099-03-31T00:00:00.000Z'),
    sessionId: 'ses_123',
    sessionToken: 'session-token',
  };
}

function createOrganizationRow(): OrganizationRow {
  return {
    id: 'org_123',
    name: 'Acme Dev',
    slug: 'acme-dev',
  };
}

function createBetaOrganizationRow(): OrganizationRow {
  return {
    id: 'org_456',
    name: 'Beta Dev',
    slug: 'beta-dev',
  };
}
