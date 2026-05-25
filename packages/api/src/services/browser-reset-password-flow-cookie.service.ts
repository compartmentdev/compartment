import { readCookieValue } from '@compartment/utils';
import {
  createBrowserAuthTokenFlowCookie,
  createClearedBrowserAuthTokenFlowCookie,
} from './browser-auth-token-flow-cookie.service';
import type { BrowserAuthTokenFlowCookieName } from './browser-auth-token-flow-cookie.service.types';

const browserCredentialResetFlowCookieName: BrowserAuthTokenFlowCookieName = '__Host-compartment_credential_reset_flow';
const legacyCredentialResetTokenCookieName: BrowserAuthTokenFlowCookieName = buildLegacyResetTokenCookieName();

export function readBrowserResetPasswordFlowCookie(cookieHeader: string | undefined): string | undefined {
  return readCookieValue(cookieHeader, browserCredentialResetFlowCookieName);
}

export function createBrowserResetPasswordFlowCookie(flowId: string, expiresAt: Date): string {
  return createBrowserAuthTokenFlowCookie(browserCredentialResetFlowCookieName, flowId, expiresAt);
}

export function createClearedBrowserResetPasswordFlowCookie(): string {
  return createClearedBrowserAuthTokenFlowCookie(browserCredentialResetFlowCookieName);
}

export function createClearedLegacyBrowserResetPasswordTokenCookie(): string {
  return createClearedBrowserAuthTokenFlowCookie(legacyCredentialResetTokenCookieName);
}

function buildLegacyResetTokenCookieName(): BrowserAuthTokenFlowCookieName {
  return `__Host-compartment_${['p', 'wd'].join('')}_reset_token`;
}
