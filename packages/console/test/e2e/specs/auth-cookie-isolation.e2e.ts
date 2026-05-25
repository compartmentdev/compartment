import {
  compartmentAppSessionCookieName,
  compartmentAuthLoginPathname,
  compartmentCsrfCookieName,
  compartmentCsrfHeaderName,
  compartmentSessionCookieName,
  compartmentWhoAmIPathname,
  loginResponseSchema,
  readCompartmentAppFlowCookieName,
  type LoginResponse,
  whoamiResponseSchema,
  type WhoAmIResponse,
} from '@compartment/contracts';
import { compartmentBrowserLoginPathname } from '@compartment/contracts/browser';
import {
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type APIResponse,
  type Cookie,
  type Page,
  type Response as PageResponse,
} from '@playwright/test';
import { test, type ConsoleFixtures } from '../fixtures/console-test';
import {
  readConsoleE2eAccount,
  readConsoleE2eAdminAccount,
  type ConsoleE2eAccount,
} from '../support/console-e2e-account';
import { readConsoleE2eBaseUrl } from '../support/console-e2e-runtime';

const legacyCompartmentAppSessionCookieName: string = 'compartment_app_session';
const legacyCompartmentSessionCookieName: string = 'compartment_session';
const reservedSecureCompartmentSessionCookieName: string = '__Secure-compartment_session';
const appReservedCookieProbeName: string = 'app_reserved_cookie_probe';

interface PageResponseHeader {
  name: string;
  value: string;
}

test.describe('console auth cookie isolation', (): void => {
  test('strips a tenant-tossed legacy session cookie before console API paths', async ({
    e2eDeployment,
    loginPage,
    page,
    projectsPage,
  }: ConsoleFixtures & { page: Page }): Promise<void> => {
    const currentAccount: ConsoleE2eAccount = readConsoleE2eAccount();
    const attackerAccount: ConsoleE2eAccount = readConsoleE2eAdminAccount();
    const baseUrl: URL = new URL(readConsoleE2eBaseUrl());

    await projectsPage.goto();
    await loginPage.login(projectsPage.getReadyLocator());

    await expectWhoAmIEmail(page.request, currentAccount.email);

    const attackerSessionToken: string = await createBrowserSessionToken(baseUrl, attackerAccount);
    await attemptLegacySessionCookieTossFromTenantApp(
      page,
      baseUrl,
      e2eDeployment.attackerRouteUrl,
      attackerSessionToken,
    );

    await expectWhoAmIEmail(page.request, currentAccount.email);
  });

  test('does not authorize target app access from a cross-tenant legacy app session cookie', async ({
    e2eDeployment,
    loginPage,
    page,
    projectsPage,
  }: ConsoleFixtures & { page: Page }): Promise<void> => {
    const attackerAccount: ConsoleE2eAccount = readConsoleE2eAdminAccount();
    const baseUrl: URL = new URL(readConsoleE2eBaseUrl());

    await projectsPage.goto();
    await loginPage.login(projectsPage.getReadyLocator());
    expectDistinctHosts(e2eDeployment.attackerRouteUrl, e2eDeployment.routeUrl);

    const attackerAppSessionToken: string = await createAppSessionToken(
      baseUrl,
      e2eDeployment.routeUrl,
      attackerAccount,
    );
    await attemptLegacyAppSessionCookieTossFromTenantApp(
      page,
      e2eDeployment.attackerRouteUrl,
      e2eDeployment.routeUrl,
      attackerAppSessionToken,
    );

    await expectAppAccessRedirect(page, e2eDeployment.routeUrl);
  });

  test('strips tenant-set current app session cookies before they reach the browser', async ({
    e2eDeployment,
    loginPage,
    page,
    projectsPage,
  }: ConsoleFixtures & { page: Page }): Promise<void> => {
    const currentAccount: ConsoleE2eAccount = readConsoleE2eAccount();
    const attackerAccount: ConsoleE2eAccount = readConsoleE2eAdminAccount();
    const baseUrl: URL = new URL(readConsoleE2eBaseUrl());

    await projectsPage.goto();
    await loginPage.login(projectsPage.getReadyLocator());
    await expectAppPrincipalEmail(page, e2eDeployment.attackerRouteUrl, currentAccount.email);

    const attackerAppSessionToken: string = await createAppSessionToken(
      baseUrl,
      e2eDeployment.attackerRouteUrl,
      attackerAccount,
    );
    await attemptHostAppSessionCookieTossFromTenantApp(page, e2eDeployment.attackerRouteUrl, attackerAppSessionToken);

    await expectAppPrincipalEmail(page, e2eDeployment.attackerRouteUrl, currentAccount.email);
  });

  test('strips tenant-set reserved Set-Cookie names before they reach the browser', async ({
    e2eDeployment,
    loginPage,
    page,
    projectsPage,
  }: ConsoleFixtures & { page: Page }): Promise<void> => {
    const currentAccount: ConsoleE2eAccount = readConsoleE2eAccount();

    await projectsPage.goto();
    await loginPage.login(projectsPage.getReadyLocator());
    await expectAppPrincipalEmail(page, e2eDeployment.attackerRouteUrl, currentAccount.email);

    await attemptReservedSetCookieTossFromTenantApp(page, e2eDeployment.attackerRouteUrl);
  });
});

async function createBrowserSessionToken(baseUrl: URL, account: ConsoleE2eAccount): Promise<string> {
  const api: APIRequestContext = await playwrightRequest.newContext({ baseURL: baseUrl.origin });
  try {
    const csrfResponse: APIResponse = await api.get(compartmentBrowserLoginPathname);
    expect(csrfResponse.status()).toBe(200);
    const csrfToken: string = readSetCookieValue(csrfResponse, compartmentCsrfCookieName);

    const loginResponse: APIResponse = await api.post(compartmentAuthLoginPathname, {
      data: {
        email: account.email,
        organizationSlug: account.organizationSlug,
        password: account.password,
        sessionDelivery: 'cookie',
      },
      headers: {
        [compartmentCsrfHeaderName]: csrfToken,
        cookie: `${compartmentCsrfCookieName}=${csrfToken}`,
        origin: baseUrl.origin,
      },
    });
    expect(loginResponse.status()).toBe(200);
    loginResponseSchema.parse(await loginResponse.json());

    return readSetCookieValue(loginResponse, compartmentSessionCookieName);
  } finally {
    await api.dispose();
  }
}

async function attemptLegacySessionCookieTossFromTenantApp(
  page: Page,
  baseUrl: URL,
  attackerRouteUrl: string,
  attackerSessionToken: string,
): Promise<void> {
  const cookieTossUrl: URL = new URL('/probe/cookie-toss', attackerRouteUrl);
  cookieTossUrl.searchParams.set('token', attackerSessionToken);

  const response: PageResponse | null = await page.goto(cookieTossUrl.toString());
  expect(response?.status()).toBe(200);
  await expect(page.locator('body')).toContainText('"cookieTossed":true');

  const consoleApiUrl: string = new URL(compartmentWhoAmIPathname, baseUrl).toString();
  const tossedCookie: Cookie | undefined = (await page.context().cookies(consoleApiUrl)).find(
    (cookie: { name: string; path: string; value: string }): boolean =>
      cookie.name === legacyCompartmentSessionCookieName && cookie.path === '/v1',
  );
  expect(tossedCookie?.value).not.toBe(attackerSessionToken);
}

async function createAppSessionToken(baseUrl: URL, routeUrl: string, account: ConsoleE2eAccount): Promise<string> {
  const api: APIRequestContext = await playwrightRequest.newContext();
  try {
    const loginRedirectResponse: APIResponse = await api.get(new URL('/probe/whoami', routeUrl).toString(), {
      maxRedirects: 0,
    });
    expect(loginRedirectResponse.status()).toBe(302);
    const loginUrl: URL = readLocationUrl(loginRedirectResponse, 'compartment login redirect');
    const loginFlowState: string = readRequiredSearchParam(loginUrl, 'state');
    readSetCookieValue(loginRedirectResponse, readCompartmentAppFlowCookieName(loginFlowState));

    const csrfResponse: APIResponse = await api.get(loginUrl.toString());
    expect(csrfResponse.status()).toBe(200);
    const csrfToken: string = readSetCookieValue(csrfResponse, compartmentCsrfCookieName);

    const loginResponse: APIResponse = await api.post(new URL(compartmentAuthLoginPathname, baseUrl).toString(), {
      data: {
        email: account.email,
        host: readRequiredSearchParam(loginUrl, 'host'),
        password: account.password,
        path: readRequiredSearchParam(loginUrl, 'path'),
        sessionDelivery: 'cookie',
        state: loginFlowState,
      },
      headers: {
        [compartmentCsrfHeaderName]: csrfToken,
        cookie: `${compartmentCsrfCookieName}=${csrfToken}`,
        origin: baseUrl.origin,
      },
    });
    expect(loginResponse.status()).toBe(200);
    const loginPayload: LoginResponse = loginResponseSchema.parse(await loginResponse.json());

    const callbackResponse: APIResponse = await api.get(requireRedirectTo(loginPayload), { maxRedirects: 0 });
    expect(callbackResponse.status()).toBe(302);

    return readSetCookieValue(callbackResponse, compartmentAppSessionCookieName);
  } finally {
    await api.dispose();
  }
}

async function attemptLegacyAppSessionCookieTossFromTenantApp(
  page: Page,
  attackerRouteUrl: string,
  targetRouteUrl: string,
  attackerAppSessionToken: string,
): Promise<void> {
  const cookieTossUrl: URL = new URL('/probe/app-session-cookie-toss', attackerRouteUrl);
  cookieTossUrl.searchParams.set('token', attackerAppSessionToken);

  const response: PageResponse | null = await page.goto(cookieTossUrl.toString());
  expect(response?.status()).toBe(200);
  await expect(page.locator('body')).toContainText('"cookieTossed":true');

  const tossedCookie: Cookie | undefined = (await page.context().cookies(targetRouteUrl)).find(
    (cookie: { name: string; path: string; value: string }): boolean =>
      cookie.name === legacyCompartmentAppSessionCookieName && cookie.path === '/',
  );
  expect(tossedCookie?.value).not.toBe(attackerAppSessionToken);
}

async function attemptHostAppSessionCookieTossFromTenantApp(
  page: Page,
  routeUrl: string,
  attackerAppSessionToken: string,
): Promise<void> {
  const cookieTossUrl: URL = new URL('/probe/host-app-session-cookie-toss', routeUrl);
  cookieTossUrl.searchParams.set('token', attackerAppSessionToken);

  const response: PageResponse | null = await page.goto(cookieTossUrl.toString());
  expect(response?.status()).toBe(200);
  await expect(page.locator('body')).toContainText('"cookieTossed":true');

  const tossedCookie: Cookie | undefined = (await page.context().cookies(routeUrl)).find(
    (cookie: { name: string; path: string; value: string }): boolean =>
      cookie.name === compartmentAppSessionCookieName && cookie.path === '/',
  );
  expect(tossedCookie?.value).not.toBe(attackerAppSessionToken);
}

async function attemptReservedSetCookieTossFromTenantApp(page: Page, routeUrl: string): Promise<void> {
  const cookieTossUrl: URL = new URL('/probe/reserved-set-cookie-toss', routeUrl);

  const response: PageResponse | null = await page.goto(cookieTossUrl.toString());
  if (response === null) {
    throw new Error('Expected reserved cookie toss response.');
  }
  expect(response.status()).toBe(200);
  await expect(page.locator('body')).toContainText('"reservedCookieTossed":true');
  const responseHeaders: PageResponseHeader[] = await response.headersArray();
  const setCookieHeaders: string[] = responseHeaders
    .filter((header: PageResponseHeader): boolean => header.name.toLowerCase() === 'set-cookie')
    .map((header: PageResponseHeader): string => header.value);
  expect(setCookieHeaders).toContain(`${appReservedCookieProbeName}=allowed; Path=/; SameSite=Lax`);
  expect(
    setCookieHeaders.some((setCookieHeader: string): boolean =>
      setCookieHeader.startsWith(`${reservedSecureCompartmentSessionCookieName}=`),
    ),
  ).toBe(false);

  const cookies: Cookie[] = await page.context().cookies(routeUrl);
  const controlCookie: Cookie | undefined = cookies.find(
    (cookie: Cookie): boolean => cookie.name === appReservedCookieProbeName && cookie.path === '/',
  );
  expect(controlCookie?.value).toBe('allowed');
  const reservedCookie: Cookie | undefined = cookies.find(
    (cookie: Cookie): boolean => cookie.name === reservedSecureCompartmentSessionCookieName && cookie.path === '/',
  );
  expect(reservedCookie).toBeUndefined();
}

async function expectWhoAmIEmail(api: APIRequestContext, expectedEmail: string): Promise<void> {
  const response: APIResponse = await api.get(compartmentWhoAmIPathname);
  expect(response.status()).toBe(200);
  const payload: WhoAmIResponse = whoamiResponseSchema.parse(await response.json());
  expect(payload.principal.email).toBe(expectedEmail);
}

async function expectAppPrincipalEmail(page: Page, routeUrl: string, expectedEmail: string): Promise<void> {
  const response: PageResponse | null = await page.goto(new URL('/probe/whoami', routeUrl).toString());
  expect(response?.status()).toBe(200);
  await expect(page.locator('body')).toContainText(`"principalEmail":"${expectedEmail}"`);
}

async function expectAppAccessRedirect(page: Page, routeUrl: string): Promise<void> {
  const response: APIResponse = await page.request.get(new URL('/probe/whoami', routeUrl).toString(), {
    maxRedirects: 0,
  });
  expect(response.status()).toBe(302);
  const location: string | undefined = response.headers().location;
  if (location === undefined) {
    throw new Error('Expected app access redirect location.');
  }

  const redirectUrl: URL = new URL(location);
  expect(redirectUrl.pathname).toBe('/login');
  expect(redirectUrl.searchParams.get('host')).toBe(new URL(routeUrl).hostname);
}

function expectDistinctHosts(leftRouteUrl: string, rightRouteUrl: string): void {
  expect(new URL(leftRouteUrl).host).not.toBe(new URL(rightRouteUrl).host);
}

function readLocationUrl(response: APIResponse, label: string): URL {
  const location: string | undefined = response.headers().location;
  if (location === undefined) {
    throw new Error(`Expected ${label} location header.`);
  }

  return new URL(location);
}

function readRequiredSearchParam(url: URL, name: string): string {
  const value: string | null = url.searchParams.get(name);
  if (value === null || value === '') {
    throw new Error(`Expected ${name} search param in ${url.toString()}.`);
  }

  return value;
}

function requireRedirectTo(payload: LoginResponse): string {
  if (payload.redirectTo === undefined) {
    throw new Error('Expected cookie login response redirect target.');
  }

  return payload.redirectTo;
}

function readSetCookieValue(response: APIResponse, cookieName: string): string {
  const cookiePrefix: string = `${cookieName}=`;
  const cookieHeader: string | undefined = response
    .headersArray()
    .find(
      (header: { name: string; value: string }): boolean =>
        header.name.toLowerCase() === 'set-cookie' && header.value.startsWith(cookiePrefix),
    )?.value;
  if (cookieHeader === undefined) {
    throw new Error(`Expected Set-Cookie for ${cookieName}.`);
  }

  const cookieValue: string | undefined = cookieHeader.slice(cookiePrefix.length).split(';')[0];
  if (cookieValue === undefined || cookieValue === '') {
    throw new Error(`Expected non-empty cookie value for ${cookieName}.`);
  }

  return cookieValue;
}
