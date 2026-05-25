import { setTimeout as sleep } from 'node:timers/promises';
import {
  compartmentAppLogoutPathname,
  compartmentAppSessionCookieName,
  compartmentAuthLogoutPathname,
  compartmentBrowserLoginPathname,
  compartmentCsrfHeaderName,
  compartmentSessionCookieName,
  logoutResponseSchema,
  whoamiResponseSchema,
  type LogoutResponse,
  type WhoAmIResponse,
} from '@compartment/contracts';
import { expect } from 'vitest';
import { z } from 'zod';
import { sendCliHttpTextRequest } from './cli-http-test.harness';
import {
  readSelfHostedAppSessionCookie,
  readSelfHostedBrowserSessions,
  sendSelfHostedAppLoginRequest,
  sendSelfHostedJsonRequest,
  type SelfHostedUserSetupAppCredentials,
  type SelfHostedUserSetupAppLoginResult,
  type SelfHostedUserSetupBrowserSessions,
  type SelfHostedUserSetupHttpResponse,
} from './self-hosted-user-setup-http.harness';

interface SelfHostedAppEnvProbe {
  DIRECT_FLAG: string | null;
  E2E_MESSAGE: string;
}

interface SelfHostedAppBuildProbe {
  E2E_BUILD_MESSAGE: string;
}

interface SelfHostedAppDatabaseWriteProbe {
  value: string;
  written: boolean;
}

interface SelfHostedAppDatabaseReadProbe {
  found: boolean;
  value: string;
}

interface SelfHostedAppWhoAmIProbe {
  accessMode: 'authenticated';
  organizationSlug: string;
  principalEmail: string;
  principalId: string;
  principalType: 'user';
}

interface SelfHostedAppIngressProbe {
  cookie: string | null;
  compartmentHeaders: SelfHostedAppIngressProbeHeaders;
}

interface SelfHostedAppIngressProbeHeaders {
  accessMode: string | null;
  organizationId: string | null;
  organizationSlug: string | null;
  principalEmail: string | null;
  principalId: string | null;
  principalType: string | null;
  role: string | null;
  upstreamPort: string | null;
}

interface SelfHostedAppLoginErrorResponse {
  error: SelfHostedAppLoginError;
}

interface SelfHostedAppLoginError {
  code: string;
  message: string;
}

interface SelfHostedAppJsonRequestOptions {
  readonly body?: string | undefined;
  readonly headers?: Record<string, string> | undefined;
  readonly method?: string | undefined;
}

const appProbePollAttempts: number = 60;
const appProbePollDelayMs: number = 1_000;
const invalidAppAccessCodeErrorCode: string = 'invalid_app_access_code';

const appEnvProbeSchema: z.ZodType<SelfHostedAppEnvProbe> = z
  .object({
    DIRECT_FLAG: z.string().nullable(),
    E2E_MESSAGE: z.string(),
  })
  .strict();
const appBuildProbeSchema: z.ZodType<SelfHostedAppBuildProbe> = z
  .object({
    E2E_BUILD_MESSAGE: z.string(),
  })
  .strict();
const appDatabaseWriteProbeSchema: z.ZodType<SelfHostedAppDatabaseWriteProbe> = z
  .object({
    value: z.string(),
    written: z.boolean(),
  })
  .strict();
const appDatabaseReadProbeSchema: z.ZodType<SelfHostedAppDatabaseReadProbe> = z
  .object({
    found: z.boolean(),
    value: z.string(),
  })
  .strict();
const appWhoAmIProbeSchema: z.ZodType<SelfHostedAppWhoAmIProbe> = z
  .object({
    accessMode: z.literal('authenticated'),
    organizationSlug: z.string(),
    principalEmail: z.string().email(),
    principalId: z.string().min(1),
    principalType: z.literal('user'),
  })
  .strict();
const appIngressProbeHeaderSchema: z.ZodType<SelfHostedAppIngressProbeHeaders> = z
  .object({
    accessMode: z.string().nullable(),
    organizationId: z.string().nullable(),
    organizationSlug: z.string().nullable(),
    principalEmail: z.string().nullable(),
    principalId: z.string().nullable(),
    principalType: z.string().nullable(),
    role: z.string().nullable(),
    upstreamPort: z.string().nullable(),
  })
  .strict();
const appIngressProbeSchema: z.ZodType<SelfHostedAppIngressProbe> = z
  .object({
    cookie: z.string().nullable(),
    compartmentHeaders: appIngressProbeHeaderSchema,
  })
  .strict();
const appLoginErrorResponseSchema: z.ZodType<SelfHostedAppLoginErrorResponse> = z
  .object({
    error: z
      .object({
        code: z.string().min(1),
        message: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export async function readAppSessionCookieWithRetry(
  routeUrl: string,
  credentials: SelfHostedUserSetupAppCredentials,
): Promise<string> {
  let lastError: Error | null = null;
  for (let attempt: number = 0; attempt < appProbePollAttempts; attempt += 1) {
    try {
      return await readSelfHostedAppSessionCookie(routeUrl, credentials);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      await sleep(appProbePollDelayMs);
    }
  }

  throw new Error(
    `Timed out waiting for app session cookie at ${routeUrl}. Last error: ${lastError?.message ?? 'none'}`,
  );
}

export async function readAppBrowserSessionsWithRetry(
  routeUrl: string,
  credentials: SelfHostedUserSetupAppCredentials,
): Promise<SelfHostedUserSetupBrowserSessions> {
  let lastError: Error | null = null;
  for (let attempt: number = 0; attempt < appProbePollAttempts; attempt += 1) {
    try {
      return await readSelfHostedBrowserSessions(routeUrl, credentials);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      await sleep(appProbePollDelayMs);
    }
  }

  throw new Error(
    `Timed out waiting for app browser sessions at ${routeUrl}. Last error: ${lastError?.message ?? 'none'}`,
  );
}

export async function expectAppEnvMessage(routeUrl: string, appSessionCookie: string, message: string): Promise<void> {
  const payload: SelfHostedAppEnvProbe = await readAppJsonWithRetry(
    appEnvProbeSchema,
    routeUrl,
    appSessionCookie,
    '/probe/env',
  );

  expect(payload.E2E_MESSAGE).toBe(message);
}

export async function expectAppDirectFlag(routeUrl: string, appSessionCookie: string, value: string): Promise<void> {
  const payload: SelfHostedAppEnvProbe = await readAppJsonWithRetry(
    appEnvProbeSchema,
    routeUrl,
    appSessionCookie,
    '/probe/env',
  );

  expect(payload.DIRECT_FLAG).toBe(value);
}

export async function expectAppBuildMessage(
  routeUrl: string,
  appSessionCookie: string,
  message: string,
): Promise<void> {
  const payload: SelfHostedAppBuildProbe = await readAppJsonWithRetry(
    appBuildProbeSchema,
    routeUrl,
    appSessionCookie,
    '/probe/build',
  );

  expect(payload.E2E_BUILD_MESSAGE).toBe(message);
}

export async function writeAppDatabaseValue(routeUrl: string, appSessionCookie: string, value: string): Promise<void> {
  const payload: SelfHostedAppDatabaseWriteProbe = await readAppJsonWithRetry(
    appDatabaseWriteProbeSchema,
    routeUrl,
    appSessionCookie,
    '/probe/db/write',
    {
      body: JSON.stringify({ value }),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  );

  expect(payload).toEqual({ value, written: true });
}

export async function expectAppDatabaseValue(
  routeUrl: string,
  appSessionCookie: string,
  value: string,
  found: boolean,
): Promise<void> {
  const payload: SelfHostedAppDatabaseReadProbe = await readAppJsonWithRetry(
    appDatabaseReadProbeSchema,
    routeUrl,
    appSessionCookie,
    `/probe/db/read?value=${encodeURIComponent(value)}`,
  );

  expect(payload).toEqual({ found, value });
}

export async function expectAppWhoAmI(
  routeUrl: string,
  appSessionCookie: string,
  email: string,
  organizationSlug: string,
): Promise<void> {
  const payload: SelfHostedAppWhoAmIProbe = await readAppJsonWithRetry(
    appWhoAmIProbeSchema,
    routeUrl,
    appSessionCookie,
    '/probe/whoami',
  );

  expect(payload.principalEmail).toBe(email);
  expect(payload.organizationSlug).toBe(organizationSlug);
}

export async function expectAppLoginRejected(
  routeUrl: string,
  credentials: SelfHostedUserSetupAppCredentials,
): Promise<void> {
  const loginResult: SelfHostedUserSetupAppLoginResult = await sendSelfHostedAppLoginRequest(routeUrl, credentials);
  const payload: SelfHostedAppLoginErrorResponse = appLoginErrorResponseSchema.parse(
    JSON.parse(loginResult.response.body),
  );

  expect(loginResult.response.statusCode).toBe(401);
  expect(payload.error.code).toBe(invalidAppAccessCodeErrorCode);
}

export async function expectTrustedAppIngress(
  routeUrl: string,
  appSessionCookie: string,
  email: string,
  organizationSlug: string,
): Promise<void> {
  const appCookie: string = 'app_runtime_cookie=keep-me';
  const reservedCookies: readonly string[] = [
    `${compartmentAppSessionCookieName}=spoofed-app-session`,
    '__Secure-compartment_session=spoofed-secure-session',
    'compartment_session=spoofed-legacy-session',
  ];
  const payload: SelfHostedAppIngressProbe = await readAppJsonWithRetry(
    appIngressProbeSchema,
    routeUrl,
    appSessionCookie,
    '/probe/ingress',
    {
      headers: {
        cookie: `${appSessionCookie}; ${reservedCookies.join('; ')}; ${appCookie}`,
        'x-compartment-access-mode': 'spoofed-access-mode',
        'x-compartment-principal-id': 'spoofed-principal-id',
        'x-compartment-role': 'spoofed-role',
        'x-compartment-upstream-port': '9999',
      },
    },
  );

  expect(payload.cookie).toContain(appCookie);
  for (const reservedCookie of reservedCookies) {
    expect(payload.cookie).not.toContain(reservedCookie);
  }
  expect(payload.cookie).not.toContain(`${compartmentAppSessionCookieName}=`);
  expect(payload.compartmentHeaders.accessMode).toBe('authenticated');
  expect(payload.compartmentHeaders.organizationId).toMatch(/^org_/);
  expect(payload.compartmentHeaders.organizationSlug).toBe(organizationSlug);
  expect(payload.compartmentHeaders.principalEmail).toBe(email);
  expect(payload.compartmentHeaders.principalId).toMatch(/^prn_/);
  expect(payload.compartmentHeaders.principalId).not.toBe('spoofed-principal-id');
  expect(payload.compartmentHeaders.principalType).toBe('user');
  expect(payload.compartmentHeaders.role).toBeNull();
  expect(payload.compartmentHeaders.upstreamPort).toBeNull();
}

export async function expectAppLogoutRevokesAppOnly(
  compartmentUrl: string,
  routeUrl: string,
  sessions: SelfHostedUserSetupBrowserSessions,
  email: string,
): Promise<void> {
  const logoutResponse: SelfHostedUserSetupHttpResponse = await sendCliHttpTextRequest(
    new URL(compartmentAppLogoutPathname, `${routeUrl}/`).toString(),
    {
      headers: {
        cookie: sessions.appSessionCookie,
        origin: new URL(routeUrl).origin,
      },
      method: 'POST',
    },
  );

  expect(logoutResponse.statusCode).toBe(302);
  expect(logoutResponse.headers.location).toBe('/');
  expect(logoutResponse.headers['set-cookie']).toContain(`${compartmentAppSessionCookieName}=`);
  await expectAppSessionRedirectedToLogin(compartmentUrl, routeUrl, sessions.appSessionCookie, '/probe/whoami');
  await expectControlPlaneSessionActive(compartmentUrl, sessions, email);
}

export async function expectControlPlaneLogoutRevokesApp(
  compartmentUrl: string,
  routeUrl: string,
  sessions: SelfHostedUserSetupBrowserSessions,
): Promise<void> {
  const logoutResponse: SelfHostedUserSetupHttpResponse = await sendCliHttpTextRequest(
    new URL(compartmentAuthLogoutPathname, `${compartmentUrl}/`).toString(),
    {
      headers: {
        [compartmentCsrfHeaderName]: sessions.csrfToken,
        cookie: `${sessions.compartmentSessionCookie}; ${sessions.csrfCookie}`,
        origin: compartmentUrl,
      },
      method: 'POST',
    },
  );
  const payload: LogoutResponse = logoutResponseSchema.parse(JSON.parse(logoutResponse.body));

  expect(logoutResponse.statusCode).toBe(200);
  expect(payload.success).toBe(true);
  expect(logoutResponse.headers['set-cookie']).toContain(`${compartmentSessionCookieName}=`);
  await expectAppSessionRedirectedToLogin(compartmentUrl, routeUrl, sessions.appSessionCookie, '/probe/whoami');
}

export async function expectAppForbidden(routeUrl: string, appSessionCookie: string, pathname: string): Promise<void> {
  const response: SelfHostedUserSetupHttpResponse = (
    await sendSelfHostedJsonRequest(new URL(pathname, `${routeUrl}/`).toString(), {
      headers: {
        cookie: appSessionCookie,
      },
    })
  ).response;

  expect(response.statusCode).toBe(403);
}

export async function expectAppSessionRedirectedToLogin(
  compartmentUrl: string,
  routeUrl: string,
  appSessionCookie: string,
  pathname: string,
): Promise<void> {
  const response: SelfHostedUserSetupHttpResponse = await sendCliHttpTextRequest(
    new URL(pathname, `${routeUrl}/`).toString(),
    {
      headers: {
        cookie: appSessionCookie,
      },
    },
  );
  const location: string | undefined = response.headers.location;

  expect(response.statusCode).toBe(302);
  if (location === undefined) {
    throw new Error('Expected app session rejection to redirect to login.');
  }
  const loginUrl: URL = new URL(location);
  expect(loginUrl.origin).toBe(new URL(compartmentUrl).origin);
  expect(loginUrl.pathname).toBe(compartmentBrowserLoginPathname);
  expect(response.headers['set-cookie']).toContain(`${compartmentAppSessionCookieName}=;`);
}

export async function expectAppRouteNotFound(
  routeUrl: string,
  appSessionCookie: string,
  pathname: string,
): Promise<void> {
  let lastStatusCode: number | null = null;
  let lastError: Error | null = null;
  for (let attempt: number = 0; attempt < appProbePollAttempts; attempt += 1) {
    try {
      const response: SelfHostedUserSetupHttpResponse = await sendCliHttpTextRequest(
        new URL(pathname, `${routeUrl}/`).toString(),
        {
          headers: {
            cookie: appSessionCookie,
          },
        },
      );

      if (response.statusCode === 404) {
        return;
      }
      lastStatusCode = response.statusCode;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
    await sleep(appProbePollDelayMs);
  }

  if (lastStatusCode !== null) {
    expect(lastStatusCode).toBe(404);
  }
  throw new Error(
    `Timed out waiting for app route ${pathname} at ${routeUrl} to return 404. Last error: ${
      lastError?.message ?? 'none'
    }`,
  );
}

async function readAppJsonWithRetry<TPayload>(
  schema: z.ZodType<TPayload>,
  routeUrl: string,
  appSessionCookie: string,
  pathname: string,
  options: SelfHostedAppJsonRequestOptions = {},
): Promise<TPayload> {
  let lastError: Error | null = null;
  for (let attempt: number = 0; attempt < appProbePollAttempts; attempt += 1) {
    try {
      const { response, value } = await sendSelfHostedJsonRequest(new URL(pathname, `${routeUrl}/`).toString(), {
        body: options.body,
        headers: {
          ...options.headers,
          cookie: options.headers?.cookie ?? appSessionCookie,
        },
        method: options.method,
      });
      if (response.statusCode === 200) {
        return schema.parse(value);
      }
      lastError = new Error(`Expected app probe ${pathname} to return 200, got ${response.statusCode.toString()}.`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
    await sleep(appProbePollDelayMs);
  }

  throw new Error(
    `Timed out waiting for app probe ${pathname} at ${routeUrl}. Last error: ${lastError?.message ?? 'none'}`,
  );
}

async function expectControlPlaneSessionActive(
  compartmentUrl: string,
  sessions: SelfHostedUserSetupBrowserSessions,
  email: string,
): Promise<void> {
  const response: SelfHostedUserSetupHttpResponse = await sendCliHttpTextRequest(
    new URL('/v1/whoami', `${compartmentUrl}/`).toString(),
    {
      headers: {
        cookie: sessions.compartmentSessionCookie,
      },
    },
  );
  const payload: WhoAmIResponse = whoamiResponseSchema.parse(JSON.parse(response.body));

  expect(response.statusCode).toBe(200);
  expect(payload.principal.email).toBe(email);
}
