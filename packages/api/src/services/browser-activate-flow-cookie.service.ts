import { readCookieValue } from '@compartment/utils';
import {
  createBrowserAuthTokenFlowCookie,
  createClearedBrowserAuthTokenFlowCookie,
} from './browser-auth-token-flow-cookie.service';
import type { BrowserAuthTokenFlowCookieName } from './browser-auth-token-flow-cookie.service.types';

const browserActivateFlowCookieName: BrowserAuthTokenFlowCookieName = '__Host-compartment_activate_flow';
const legacyBrowserActivateTokenCookieName: BrowserAuthTokenFlowCookieName = '__Host-compartment_activate_token';

export function readBrowserActivateFlowCookie(cookieHeader: string | undefined): string | undefined {
  return readCookieValue(cookieHeader, browserActivateFlowCookieName);
}

export function createBrowserActivateFlowCookie(flowId: string, expiresAt: Date): string {
  return createBrowserAuthTokenFlowCookie(browserActivateFlowCookieName, flowId, expiresAt);
}

export function createClearedBrowserActivateFlowCookie(): string {
  return createClearedBrowserAuthTokenFlowCookie(browserActivateFlowCookieName);
}

export function createClearedLegacyBrowserActivateTokenCookie(): string {
  return createClearedBrowserAuthTokenFlowCookie(legacyBrowserActivateTokenCookieName);
}
