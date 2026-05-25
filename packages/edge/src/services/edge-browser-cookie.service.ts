import type { EdgeBrowserCookieOptions } from './edge-browser-cookie.service.types';

export function buildEdgeBrowserCookieOptions(): EdgeBrowserCookieOptions {
  return {
    httpOnly: true,
    path: '/',
    sameSite: 'Lax',
    secure: true,
  };
}
