import { serializeCookie } from '@compartment/utils';
import type {
  BrowserAuthTokenFlowCookieName,
  BrowserAuthTokenFlowCookieOptions,
} from './browser-auth-token-flow-cookie.service.types';

export function createBrowserAuthTokenFlowCookie(
  name: BrowserAuthTokenFlowCookieName,
  flowId: string,
  expiresAt: Date,
): string {
  return serializeBrowserAuthTokenFlowCookie(name, flowId, { expires: expiresAt });
}

export function createClearedBrowserAuthTokenFlowCookie(name: BrowserAuthTokenFlowCookieName): string {
  return serializeBrowserAuthTokenFlowCookie(name, '', {
    expires: new Date(0),
    maxAgeSeconds: 0,
  });
}

function serializeBrowserAuthTokenFlowCookie(
  name: BrowserAuthTokenFlowCookieName,
  flowId: string,
  options: BrowserAuthTokenFlowCookieOptions,
): string {
  return serializeCookie(name, flowId, {
    ...options,
    httpOnly: true,
    path: '/',
    sameSite: 'Lax',
    secure: true,
  });
}
