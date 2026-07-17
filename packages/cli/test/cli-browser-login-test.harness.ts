import {
  compartmentCliLoginAttemptCookieName,
  compartmentCsrfCookieName,
  compartmentCsrfHeaderName,
} from '@compartment/contracts';
import { readCookieValue, type JsonValue } from '@compartment/utils';
import { readJsonRecord, readRequiredString } from '../src/json.helpers';

interface BootstrappedCliBrowserLogin {
  readonly browserOrigin: string;
  readonly cliAttemptCookie: string;
  readonly loginUrl: string;
  readonly requestOrigin: string;
  readonly verificationHost: string | undefined;
}

interface CliBrowserLoginBootstrapInput {
  readonly request?: CliBrowserLoginRequest | undefined;
  readonly requestOrigin?: string | undefined;
  readonly verificationUrlPromise: Promise<string>;
}

interface CliBrowserPasswordLoginInput extends CliBrowserLoginBootstrapInput {
  readonly email: string;
  readonly password: string;
}

type CliBrowserLoginHeaders = Record<string, string>;

export interface CliBrowserLoginRequestInit {
  readonly body?: string | undefined;
  readonly headers?: CliBrowserLoginHeaders | undefined;
  readonly method?: 'POST' | undefined;
}

type CliBrowserLoginRequest = (url: URL, init?: CliBrowserLoginRequestInit) => Promise<Response>;

export async function completeCliBrowserPasswordLogin(input: CliBrowserPasswordLoginInput): Promise<void> {
  const request: CliBrowserLoginRequest = input.request ?? requestCliBrowserLogin;
  const bootstrapped: BootstrappedCliBrowserLogin = await bootstrapCliBrowserLogin(input);
  const loginUrl: URL = resolveCliBrowserLoginUrl(bootstrapped, bootstrapped.loginUrl);
  const organizationSlug: string | null = loginUrl.searchParams.get('organizationSlug');
  const loginPageResponse: Response = await request(loginUrl, {
    headers: buildCliBrowserLoginHeaders(bootstrapped, {
      cookie: bootstrapped.cliAttemptCookie,
    }),
  });
  if (!loginPageResponse.ok) {
    throw new Error(`Expected browser login page to load, got ${loginPageResponse.status}.`);
  }

  const csrfCookie: string = requireCookieRequestPair(
    loginPageResponse.headers.getSetCookie(),
    compartmentCsrfCookieName,
  );
  const csrfToken: string = requireCookieValue(csrfCookie, compartmentCsrfCookieName);
  const loginResponse: Response = await request(resolveCliBrowserLoginUrl(bootstrapped, '/v1/auth/login'), {
    method: 'POST',
    headers: buildCliBrowserLoginHeaders(bootstrapped, {
      'content-type': 'application/json',
      cookie: `${bootstrapped.cliAttemptCookie}; ${csrfCookie}`,
      [compartmentCsrfHeaderName]: csrfToken,
      origin: bootstrapped.browserOrigin,
    }),
    body: JSON.stringify({
      email: input.email,
      ...(organizationSlug !== null ? { organizationSlug } : {}),
      password: input.password,
      sessionDelivery: 'cookie',
    }),
  });

  if (!loginResponse.ok) {
    throw new Error(`Expected browser login completion to succeed, got ${loginResponse.status}.`);
  }
}

async function requestCliBrowserLogin(url: URL, init?: CliBrowserLoginRequestInit): Promise<Response> {
  return await fetch(url, {
    ...(init?.body === undefined ? {} : { body: init.body }),
    ...(init?.headers === undefined ? {} : { headers: init.headers }),
    ...(init?.method === undefined ? {} : { method: init.method }),
  });
}

async function bootstrapCliBrowserLogin(input: CliBrowserLoginBootstrapInput): Promise<BootstrappedCliBrowserLogin> {
  const verificationUrl: URL = new URL(await input.verificationUrlPromise);
  const requestOrigin: string = input.requestOrigin ?? verificationUrl.origin;
  const attemptId: string = verificationUrl.searchParams.get('attempt') ?? '';
  const browserCode: string = verificationUrl.hash.replace(/^#code=/u, '');
  if (attemptId === '' || browserCode === '') {
    throw new Error(`Expected verification URL with attempt and code: ${verificationUrl.toString()}`);
  }

  const bootstrapResponse: Response = await (input.request ?? requestCliBrowserLogin)(
    new URL(`${verificationUrl.pathname}${verificationUrl.search}`, requestOrigin),
    {
      method: 'POST',
      headers: buildCliBrowserLoginHeaders(readCliBrowserLoginContext(verificationUrl, requestOrigin), {
        'content-type': 'application/json',
      }),
      body: JSON.stringify({
        attempt: attemptId,
        code: browserCode,
      }),
    },
  );
  if (!bootstrapResponse.ok) {
    throw new Error(`Expected CLI browser bootstrap to succeed, got ${bootstrapResponse.status}.`);
  }

  const bootstrapPayload: JsonValue = (await bootstrapResponse.json()) as JsonValue;

  return {
    ...readCliBrowserLoginContext(verificationUrl, requestOrigin),
    cliAttemptCookie: requireCookieRequestPair(
      bootstrapResponse.headers.getSetCookie(),
      compartmentCliLoginAttemptCookieName,
    ),
    loginUrl: readRequiredString(readJsonRecord(bootstrapPayload), 'loginUrl'),
  };
}

function resolveCliBrowserLoginUrl(bootstrapped: BootstrappedCliBrowserLogin, path: string): URL {
  return new URL(path, bootstrapped.requestOrigin);
}

function buildCliBrowserLoginHeaders(
  bootstrapped: Pick<BootstrappedCliBrowserLogin, 'verificationHost'>,
  headers: CliBrowserLoginHeaders,
): CliBrowserLoginHeaders {
  if (bootstrapped.verificationHost === undefined) {
    return headers;
  }

  return {
    ...headers,
    host: bootstrapped.verificationHost,
  };
}

function readCliBrowserLoginContext(
  verificationUrl: URL,
  requestOrigin: string,
): Pick<BootstrappedCliBrowserLogin, 'browserOrigin' | 'requestOrigin' | 'verificationHost'> {
  return {
    browserOrigin: verificationUrl.origin,
    requestOrigin,
    verificationHost: requestOrigin === verificationUrl.origin ? undefined : verificationUrl.host,
  };
}

function requireCookieRequestPair(cookies: readonly string[], cookieName: string): string {
  const cookie: string | undefined = cookies.find((candidate: string): boolean =>
    candidate.startsWith(`${cookieName}=`),
  );
  if (cookie === undefined) {
    throw new Error(`Expected ${cookieName} cookie.`);
  }

  return cookie.split(';')[0] ?? cookie;
}

function requireCookieValue(cookie: string, cookieName: string): string {
  const value: string | undefined = readCookieValue(cookie, cookieName);
  if (value === undefined || value === '') {
    throw new Error(`Expected ${cookieName} cookie value.`);
  }

  return value;
}
