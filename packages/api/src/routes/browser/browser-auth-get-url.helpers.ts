import { browserLoginPathname } from '../../browser-public-paths';
import { appendBrowserFlowSearchParams } from './browser-flow.helpers';
import type { BrowserFlowFields } from './browser-flow.types';

interface BrowserAuthGetQuery extends BrowserFlowFields {
  autoRedirect?: boolean | undefined;
  email?: string | undefined;
}

export function buildBrowserLoginGetUrl(query: BrowserAuthGetQuery): string {
  return buildBrowserAuthGetUrl(browserLoginPathname, query);
}

export function buildBrowserAuthGetUrl(pathname: string, query: BrowserAuthGetQuery): string {
  const searchParams: URLSearchParams = new URLSearchParams();
  if (query.autoRedirect === false) {
    searchParams.set('autoRedirect', 'false');
  }
  if (query.email !== undefined) {
    searchParams.set('email', query.email);
  }
  appendBrowserFlowSearchParams(searchParams, query);

  const queryString: string = searchParams.toString();

  return queryString === '' ? pathname : `${pathname}?${queryString}`;
}
