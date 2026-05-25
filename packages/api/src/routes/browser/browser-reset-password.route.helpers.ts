import { browserResetPasswordPathname } from '../../browser-public-paths';
import { buildBrowserAuthGetUrl } from './browser-auth-get-url.helpers';
import type { BrowserResetPasswordQuery } from './browser-reset-password.route.types';

export function buildBrowserResetPasswordGetUrl(query: BrowserResetPasswordQuery): string {
  return buildBrowserAuthGetUrl(browserResetPasswordPathname, query);
}
