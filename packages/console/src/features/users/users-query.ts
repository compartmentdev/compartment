import type {
  BrowserUsersPageResult,
  BrowserUsersPageSize,
  BrowserUsersSortBy,
  BrowserUsersSortDirection,
} from '../../services/browser-users.service.types';
import { browserUsersPathname } from '../../browser-public-paths';
import {
  buildServerTableHref,
  readNextServerTableSortDirection,
  type ServerTableHrefDefaults,
  type ServerTableHrefOverrides,
} from '../../lib/server-table-query';

interface UsersHrefOverrides extends ServerTableHrefOverrides<
  BrowserUsersSortBy,
  BrowserUsersSortDirection,
  BrowserUsersPageSize
> {
  mode?: 'create' | 'detail' | 'list' | undefined;
  selectedUserEmail?: string | null | undefined;
}

const usersHrefDefaults: ServerTableHrefDefaults<BrowserUsersSortBy, BrowserUsersSortDirection, BrowserUsersPageSize> =
  {
    page: 1,
    pageSize: 10,
    sortBy: 'email',
    sortDirection: 'asc',
  };

export function buildUsersHref(data: BrowserUsersPageResult, overrides?: UsersHrefOverrides): string {
  const href: string = buildServerTableHref(browserUsersPathname, data, usersHrefDefaults, overrides);
  const url: URL = new URL(`http://localhost${href}`);
  const selectedUserEmail: string | null =
    overrides?.selectedUserEmail === undefined ? data.selectedUserEmail : overrides.selectedUserEmail;
  const mode: 'create' | 'detail' | 'list' = overrides?.mode ?? data.mode;
  if (selectedUserEmail === null) {
    url.searchParams.delete('userEmail');
  } else {
    url.searchParams.set('userEmail', selectedUserEmail);
  }
  if (mode === 'create') {
    url.searchParams.set('mode', 'create');
  } else {
    url.searchParams.delete('mode');
  }

  return `${url.pathname}${url.search}`;
}

export function readNextUsersSortDirection(
  data: BrowserUsersPageResult,
  sortBy: BrowserUsersSortBy,
): BrowserUsersSortDirection {
  return readNextServerTableSortDirection(data.sortBy, data.sortDirection, sortBy, sortBy === 'email' ? 'asc' : 'desc');
}
