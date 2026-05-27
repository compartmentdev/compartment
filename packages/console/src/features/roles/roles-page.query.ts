import {
  browserGroupsPathname,
  browserRolesPathname,
  browserUsersPathname,
  buildBrowserOrganizationScopedPathname,
} from '../../browser-public-paths';
import {
  appendDefaultedNumberParam,
  appendDefaultedParam,
  appendTextParam,
  readNextServerTableSortDirection,
  type ServerTableHrefOverrides,
} from '../../lib/server-table-query';
import type {
  BrowserRolesPageResult,
  BrowserRolesPageSize,
  BrowserRolesSortBy,
  BrowserRolesSortDirection,
} from '../../services/browser-roles.service.types';

export interface RolesBackLink {
  href: string;
  label: string;
}

interface RolesHrefInput {
  backHref?: string | undefined;
  mode?: 'create' | 'detail' | 'edit' | 'list';
  organizationSlug: string | null;
  page?: number | undefined;
  pageSize?: BrowserRolesPageSize | undefined;
  roleId?: string | null;
  searchQuery?: string | undefined;
  sortBy?: BrowserRolesSortBy | undefined;
  sortDirection?: BrowserRolesSortDirection | undefined;
}

interface RolesPageHrefContext {
  backHref?: string | undefined;
  page?: number | undefined;
  pageSize?: BrowserRolesPageSize | undefined;
  searchQuery?: string | undefined;
  selectedOrganizationSlug: string | null;
  sortBy?: BrowserRolesSortBy | undefined;
  sortDirection?: BrowserRolesSortDirection | undefined;
}

type RolesHrefOverrides = ServerTableHrefOverrides<
  BrowserRolesSortBy,
  BrowserRolesSortDirection,
  BrowserRolesPageSize
> & {
  backHref?: string | undefined;
  mode?: 'create' | 'detail' | 'edit' | 'list';
  roleId?: string | null | undefined;
};

const browserConsoleOrigin: string = 'http://console.localhost';
const defaultRolesPage: number = 1;
const defaultRolesPageSize: BrowserRolesPageSize = 10;
const defaultRolesSortBy: BrowserRolesSortBy = 'name';
const defaultRolesSortDirection: BrowserRolesSortDirection = 'asc';
const rolesReturnToSearchParamName: string = 'returnTo';

export function buildRolesPageHref(context: RolesPageHrefContext, input: RolesHrefOverrides = {}): string {
  return buildRolesHref(readRolesPageHrefInput(context, input));
}

export function buildRolesOrganizationHref(
  selectedOrganizationSlug: string,
  input: Omit<RolesHrefInput, 'organizationSlug'> = {},
): string {
  return buildRolesHref({
    ...input,
    organizationSlug: selectedOrganizationSlug,
  });
}

export function buildRolesHref(input: RolesHrefInput): string {
  const searchParams: URLSearchParams = new URLSearchParams();
  appendRolesQueryParams(searchParams, input);

  const query: string = searchParams.toString();
  const pathname: string = readRolesPathname(input.organizationSlug);
  return query === '' ? pathname : `${pathname}?${query}`;
}

export function readNextRolesSortDirection(
  data: BrowserRolesPageResult,
  sortBy: BrowserRolesSortBy,
): BrowserRolesSortDirection {
  return readNextServerTableSortDirection(
    data.sortBy,
    data.sortDirection,
    sortBy,
    sortBy === 'assignmentCount' ? 'desc' : 'asc',
  );
}

export function readRolesBackHref(
  searchParams: URLSearchParams,
  selectedOrganizationSlug: string | null,
): string | undefined {
  return readRolesBackLink(searchParams.get(rolesReturnToSearchParamName) ?? undefined, selectedOrganizationSlug)?.href;
}

export function readRolesBackLink(
  backHref: string | undefined,
  selectedOrganizationSlug: string | null,
): RolesBackLink | null {
  if (backHref === undefined || backHref === '' || selectedOrganizationSlug === null) {
    return null;
  }

  const url: URL | null = readRolesRelativeUrl(backHref);
  if (url === null) {
    return null;
  }

  const label: string | null = readRolesBackLabel(url.pathname, selectedOrganizationSlug);
  if (label === null) {
    return null;
  }

  return {
    href: `${url.pathname}${url.search}`,
    label,
  };
}

function appendRolesQueryParams(searchParams: URLSearchParams, input: RolesHrefInput): void {
  appendTextParam(searchParams, 'q', input.searchQuery ?? '');
  appendDefaultedParam(searchParams, 'sortBy', input.sortBy ?? defaultRolesSortBy, defaultRolesSortBy);
  appendDefaultedParam(
    searchParams,
    'sortDirection',
    input.sortDirection ?? defaultRolesSortDirection,
    defaultRolesSortDirection,
  );
  appendDefaultedNumberParam(searchParams, 'page', input.page ?? defaultRolesPage, defaultRolesPage);
  appendDefaultedNumberParam(searchParams, 'pageSize', input.pageSize ?? defaultRolesPageSize, defaultRolesPageSize);
  if (input.roleId !== null && input.roleId !== undefined) {
    searchParams.set('roleId', input.roleId);
  }
  if (input.mode === 'create' || input.mode === 'edit') {
    searchParams.set('mode', input.mode);
  }
  appendRolesBackHref(searchParams, input.backHref);
}

function appendRolesBackHref(searchParams: URLSearchParams, backHref: string | undefined): void {
  if (backHref === undefined || backHref === '') {
    return;
  }

  searchParams.set(rolesReturnToSearchParamName, backHref);
}

function readRolesPageHrefInput(context: RolesPageHrefContext, input: RolesHrefOverrides): RolesHrefInput {
  return {
    backHref: input.backHref ?? context.backHref,
    mode: input.mode ?? 'list',
    organizationSlug: input.selectedOrganizationSlug ?? context.selectedOrganizationSlug,
    page: input.page ?? context.page ?? defaultRolesPage,
    pageSize: input.pageSize ?? context.pageSize ?? defaultRolesPageSize,
    roleId: input.roleId ?? null,
    searchQuery: input.searchQuery ?? context.searchQuery ?? '',
    sortBy: input.sortBy ?? context.sortBy ?? defaultRolesSortBy,
    sortDirection: input.sortDirection ?? context.sortDirection ?? defaultRolesSortDirection,
  };
}

function readRolesPathname(organizationSlug: string | null): string {
  return organizationSlug === null
    ? browserRolesPathname
    : buildBrowserOrganizationScopedPathname(organizationSlug, browserRolesPathname);
}

function readRolesBackLabel(pathname: string, selectedOrganizationSlug: string): string | null {
  if (pathname === buildBrowserOrganizationScopedPathname(selectedOrganizationSlug, browserUsersPathname)) {
    return 'Back to Users';
  }
  if (pathname === buildBrowserOrganizationScopedPathname(selectedOrganizationSlug, browserGroupsPathname)) {
    return 'Back to Groups';
  }

  return null;
}

function readRolesRelativeUrl(href: string): URL | null {
  try {
    const url: URL = new URL(href, browserConsoleOrigin);
    return url.origin === browserConsoleOrigin ? url : null;
  } catch {
    return null;
  }
}
