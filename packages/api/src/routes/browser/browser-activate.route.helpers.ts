import { browserActivatePathname } from '../../browser-public-paths';
import { buildBrowserAuthGetUrl } from './browser-auth-get-url.helpers';
import type { BrowserActivateQuery } from './browser-activate.route.types';

export function buildBrowserActivateGetUrl(query: BrowserActivateQuery): string {
  return buildBrowserAuthGetUrl(browserActivatePathname, query);
}
