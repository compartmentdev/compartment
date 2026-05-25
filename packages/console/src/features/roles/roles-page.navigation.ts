import type { ShouldRevalidateFunctionArgs } from 'react-router';
import type { BrowserRolesPageResult } from '../../services/browser-roles.service.types';
import { buildRolesPageHref } from './roles-page.query';
import type { RolesPageState } from './roles-page.state';

export function shouldRevalidateRolesPage(args: ShouldRevalidateFunctionArgs): boolean {
  if (isClosingRolesDrawer(args.currentUrl, args.nextUrl)) {
    return false;
  }

  return args.defaultShouldRevalidate;
}

export function closeRolesDrawerAfterMutation(state: RolesPageState): void {
  const href: string = buildRolesPageHref(state.data);
  state.setData(readClosedRolesPageData);
  state.onNavigate(href);
}

function readClosedRolesPageData(current: BrowserRolesPageResult): BrowserRolesPageResult {
  return {
    ...current,
    mode: 'list',
    role: null,
    roleId: null,
  };
}

function isClosingRolesDrawer(currentUrl: URL, nextUrl: URL): boolean {
  if (currentUrl.pathname !== nextUrl.pathname) {
    return false;
  }

  if (currentUrl.searchParams.get('organization') !== nextUrl.searchParams.get('organization')) {
    return false;
  }

  return isPersistedRoleDrawerUrl(currentUrl) && isRoleListUrl(nextUrl);
}

function isPersistedRoleDrawerUrl(url: URL): boolean {
  return url.searchParams.get('mode') === 'edit' || url.searchParams.has('roleId');
}

function isRoleListUrl(url: URL): boolean {
  return !url.searchParams.has('mode') && !url.searchParams.has('roleId');
}
