import {
  compartmentAppSessionCookieName,
  compartmentAuthLoginPathname,
  compartmentCsrfCookieName,
  compartmentCsrfHeaderName,
  compartmentSessionCookieName,
  loginResponseSchema,
  readCompartmentAppFlowCookieName,
  type LoginResponse,
} from '@compartment/contracts';
import type { JsonValue } from '@compartment/utils';
import {
  readCliHttpSetCookieValue,
  sendCliHttpTextRequest,
  type CliHttpTextRequestOptions,
  type CliHttpTextResponse,
} from './cli-http-test.harness';

export interface SelfHostedUserSetupAppCredentials {
  readonly email: string;
  readonly password: string;
}

export interface SelfHostedUserSetupBrowserSessions {
  readonly appSessionCookie: string;
  readonly appSessionToken: string;
  readonly compartmentSessionCookie: string;
  readonly compartmentSessionToken: string;
  readonly csrfCookie: string;
  readonly csrfToken: string;
}

export interface SelfHostedUserSetupAppLoginResult {
  readonly csrfToken: string;
  readonly flowCookieHeader: string;
  readonly response: SelfHostedUserSetupHttpResponse;
}

export type SelfHostedUserSetupHttpResponse = CliHttpTextResponse;

export async function readSelfHostedAppSessionCookie(
  routeUrl: string,
  credentials: SelfHostedUserSetupAppCredentials,
): Promise<string> {
  return (await readSelfHostedBrowserSessions(routeUrl, credentials)).appSessionCookie;
}

export async function sendSelfHostedAppLoginRequest(
  routeUrl: string,
  credentials: SelfHostedUserSetupAppCredentials,
): Promise<SelfHostedUserSetupAppLoginResult> {
  const loginRedirectResponse: SelfHostedUserSetupHttpResponse = await sendCliHttpTextRequest(routeUrl);
  const loginUrl: URL = readLocationUrl(loginRedirectResponse, 'compartment login redirect');
  const loginFlowState: string = requireSearchParam(loginUrl, 'state');
  const flowCookieHeader: string = readAppFlowStateCookieHeader(
    loginRedirectResponse.headers['set-cookie'],
    loginFlowState,
  );
  const loginPageResponse: SelfHostedUserSetupHttpResponse = await sendCliHttpTextRequest(loginUrl.toString());
  const csrfToken: string = readCliHttpSetCookieValue(
    loginPageResponse.headers['set-cookie'],
    compartmentCsrfCookieName,
  );
  const loginBody: string = JSON.stringify({
    email: credentials.email,
    host: requireSearchParam(loginUrl, 'host'),
    password: credentials.password,
    path: requireSearchParam(loginUrl, 'path'),
    sessionDelivery: 'cookie',
    state: loginFlowState,
  });
  const response: SelfHostedUserSetupHttpResponse = await sendCliHttpTextRequest(
    new URL(compartmentAuthLoginPathname, loginUrl).toString(),
    {
      body: loginBody,
      headers: {
        [compartmentCsrfHeaderName]: csrfToken,
        cookie: `${compartmentCsrfCookieName}=${csrfToken}`,
        'content-type': 'application/json',
        origin: loginUrl.origin,
      },
      method: 'POST',
    },
  );

  return { csrfToken, flowCookieHeader, response };
}

export async function readSelfHostedBrowserSessions(
  routeUrl: string,
  credentials: SelfHostedUserSetupAppCredentials,
): Promise<SelfHostedUserSetupBrowserSessions> {
  const {
    csrfToken,
    flowCookieHeader,
    response: loginResponse,
  }: SelfHostedUserSetupAppLoginResult = await sendSelfHostedAppLoginRequest(routeUrl, credentials);
  const loginPayload: LoginResponse = loginResponseSchema.parse(JSON.parse(loginResponse.body));
  const compartmentSessionToken: string = readCliHttpSetCookieValue(
    loginResponse.headers['set-cookie'],
    compartmentSessionCookieName,
  );
  const callbackResponse: SelfHostedUserSetupHttpResponse = await sendCliHttpTextRequest(
    new URL(requireRedirectTo(loginPayload)).toString(),
    {
      headers: {
        cookie: flowCookieHeader,
      },
    },
  );
  const appSessionToken: string = readCliHttpSetCookieValue(
    callbackResponse.headers['set-cookie'],
    compartmentAppSessionCookieName,
  );

  return {
    appSessionCookie: `${compartmentAppSessionCookieName}=${appSessionToken}`,
    appSessionToken,
    compartmentSessionCookie: `${compartmentSessionCookieName}=${compartmentSessionToken}`,
    compartmentSessionToken,
    csrfCookie: `${compartmentCsrfCookieName}=${csrfToken}`,
    csrfToken,
  };
}

export async function sendSelfHostedJsonRequest(
  url: string,
  options: CliHttpTextRequestOptions = {},
): Promise<{ readonly response: SelfHostedUserSetupHttpResponse; readonly value: JsonValue }> {
  const response: SelfHostedUserSetupHttpResponse = await sendCliHttpTextRequest(url, options);

  return {
    response,
    value: JSON.parse(response.body) as JsonValue,
  };
}

function readLocationUrl(response: SelfHostedUserSetupHttpResponse, label: string): URL {
  const location: string | undefined = response.headers.location;
  if (location === undefined) {
    throw new Error(`Expected ${label} location header.`);
  }

  return new URL(location);
}

function requireSearchParam(url: URL, name: string): string {
  const value: string | null = url.searchParams.get(name);
  if (value === null) {
    throw new Error(`Expected "${name}" in ${url.toString()}.`);
  }

  return value;
}

function readAppFlowStateCookieHeader(setCookieHeader: string | undefined, state: string): string {
  const cookieName: string = readCompartmentAppFlowCookieName(state);
  const cookieValue: string = readCliHttpSetCookieValue(setCookieHeader, cookieName);

  return `${cookieName}=${cookieValue}`;
}

function requireRedirectTo(response: LoginResponse): string {
  if (response.redirectTo === undefined) {
    throw new Error('Expected login response redirect target.');
  }

  return response.redirectTo;
}
