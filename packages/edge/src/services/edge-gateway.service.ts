import {
  compartmentAppSessionCookieName,
  type AppAccessExchangeRequest,
  type AppAccessExchangeResponse,
  type AppAccessSessionState,
  type AppAccessSessionResolveResponse,
} from '@compartment/contracts';
import {
  createCompartmentRequester,
  exchangeAppAccess,
  logoutAppAccess,
  resolveAppAccessSession,
  type CompartmentRequester,
} from '@compartment/sdk';
import { parseHttpHostAuthority, readCookieValue, serializeCookie } from '@compartment/utils';
import type { EdgeConfig } from '../config';

export async function exchangeAppAccessCodeWithApi(
  config: EdgeConfig,
  input: AppAccessExchangeRequest,
): Promise<AppAccessExchangeResponse> {
  return await exchangeAppAccess(createEdgeRequester(config), input);
}

export async function logoutAppAccessWithApi(config: EdgeConfig, appSessionToken: string | null): Promise<void> {
  await logoutAppAccess(createEdgeRequester(config), { appSessionToken });
}

export async function resolveAppAccessSessionWithApi(
  config: EdgeConfig,
  appSessionToken: string,
): Promise<AppAccessSessionState | null> {
  const response: AppAccessSessionResolveResponse = await resolveAppAccessSession(createEdgeRequester(config), {
    appSessionToken,
  });
  return response.session;
}

export function readAppSessionToken(cookieHeader: string | undefined): string | null {
  return readCookieValue(cookieHeader, compartmentAppSessionCookieName) ?? null;
}

export function readRequestHost(hostHeader: string | undefined): string | null {
  return parseHttpHostAuthority(hostHeader)?.host ?? null;
}

export function buildAppSessionCookie(appSessionToken: string, expiresAt: string): string {
  return serializeCookie(compartmentAppSessionCookieName, appSessionToken, {
    expires: new Date(expiresAt),
    httpOnly: true,
    path: '/',
    sameSite: 'Lax',
    secure: true,
  });
}

export function buildClearedAppSessionCookie(): string {
  return serializeCookie(compartmentAppSessionCookieName, '', {
    expires: new Date(0),
    httpOnly: true,
    maxAgeSeconds: 0,
    path: '/',
    sameSite: 'Lax',
    secure: true,
  });
}
function createEdgeRequester(config: EdgeConfig): CompartmentRequester {
  return createCompartmentRequester({
    apiUrl: config.apiUrl,
    internalToken: config.edgeToken,
  });
}
