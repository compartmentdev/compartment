import { hasText } from '@compartment/utils';
import { buildBrowserOrganizationScopedPathname } from '../browser-public-paths';
import type { BrowserTablePageSize, BrowserTableSortDirection } from '../services/browser-table.service.types';
import { normalizeBrowserSearchQuery } from './search-query';

export interface ServerTableHrefOverrides<
  TSortBy extends string,
  TSortDirection extends BrowserTableSortDirection,
  TPageSize extends BrowserTablePageSize,
> {
  archiveState?: string | undefined;
  page?: number | undefined;
  pageSize?: TPageSize | undefined;
  searchQuery?: string | undefined;
  selectedOrganizationSlug?: string | null | undefined;
  sortBy?: TSortBy | undefined;
  sortDirection?: TSortDirection | undefined;
}

interface ServerTableHrefState<
  TSortBy extends string,
  TSortDirection extends BrowserTableSortDirection,
  TPageSize extends BrowserTablePageSize,
> {
  archiveState?: string | undefined;
  page: number;
  pageSize: TPageSize;
  searchQuery: string;
  selectedOrganizationSlug: string | null;
  showOrganizationSelector: boolean;
  sortBy: TSortBy;
  sortDirection: TSortDirection;
}

export interface ServerTableHrefDefaults<
  TSortBy extends string,
  TSortDirection extends BrowserTableSortDirection,
  TPageSize extends BrowserTablePageSize,
> {
  archiveState?: string | undefined;
  page: number;
  pageSize: TPageSize;
  sortBy: TSortBy;
  sortDirection: TSortDirection;
}

interface ResolvedServerTableQuery<
  TSortBy extends string,
  TSortDirection extends BrowserTableSortDirection,
  TPageSize extends BrowserTablePageSize,
> {
  archiveState?: string | undefined;
  page: number;
  pageSize: TPageSize;
  searchQuery: string;
  selectedOrganizationSlug: string | null;
  sortBy: TSortBy;
  sortDirection: TSortDirection;
}

export function buildServerTableHref<
  TSortBy extends string,
  TSortDirection extends BrowserTableSortDirection,
  TPageSize extends BrowserTablePageSize,
>(
  basePath: string,
  data: Readonly<ServerTableHrefState<TSortBy, TSortDirection, TPageSize>>,
  defaults: Readonly<ServerTableHrefDefaults<TSortBy, TSortDirection, TPageSize>>,
  overrides?: Readonly<ServerTableHrefOverrides<TSortBy, TSortDirection, TPageSize>>,
): string {
  const query: ResolvedServerTableQuery<TSortBy, TSortDirection, TPageSize> = resolveServerTableQuery(data, overrides);
  const searchParams: URLSearchParams = new URLSearchParams();
  appendServerTableSearchParams(searchParams, defaults, query);
  const queryString: string = searchParams.toString();
  const pathname: string =
    query.selectedOrganizationSlug === null
      ? basePath
      : buildBrowserOrganizationScopedPathname(query.selectedOrganizationSlug, basePath);

  return queryString === '' ? pathname : `${pathname}?${queryString}`;
}

export function readBrowserTablePageSize(value: string): BrowserTablePageSize {
  switch (value) {
    case '20':
      return 20;
    case '50':
      return 50;
    default:
      return 10;
  }
}

export function readPositiveIntegerSearchParam(value: string | null, fallback: number): number {
  const parsed: number = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function readTrimmedSearchParam(searchParams: URLSearchParams, name: string): string {
  return normalizeBrowserSearchQuery(searchParams.get(name));
}

export function readNextServerTableSortDirection<TSortBy extends string>(
  currentSortBy: TSortBy,
  currentSortDirection: BrowserTableSortDirection,
  sortBy: TSortBy,
  defaultSortDirection: BrowserTableSortDirection,
): BrowserTableSortDirection {
  if (currentSortBy === sortBy) {
    return currentSortDirection === 'asc' ? 'desc' : 'asc';
  }

  return defaultSortDirection;
}

function resolveServerTableQuery<
  TSortBy extends string,
  TSortDirection extends BrowserTableSortDirection,
  TPageSize extends BrowserTablePageSize,
>(
  data: Readonly<ServerTableHrefState<TSortBy, TSortDirection, TPageSize>>,
  overrides?: Readonly<ServerTableHrefOverrides<TSortBy, TSortDirection, TPageSize>>,
): ResolvedServerTableQuery<TSortBy, TSortDirection, TPageSize> {
  return {
    archiveState: overrides?.archiveState ?? data.archiveState,
    page: overrides?.page ?? data.page,
    pageSize: overrides?.pageSize ?? data.pageSize,
    searchQuery: normalizeBrowserSearchQuery(overrides?.searchQuery ?? data.searchQuery),
    selectedOrganizationSlug:
      overrides?.selectedOrganizationSlug === undefined
        ? data.selectedOrganizationSlug
        : overrides.selectedOrganizationSlug,
    sortBy: overrides?.sortBy ?? data.sortBy,
    sortDirection: overrides?.sortDirection ?? data.sortDirection,
  };
}

function appendServerTableSearchParams<
  TSortBy extends string,
  TSortDirection extends BrowserTableSortDirection,
  TPageSize extends BrowserTablePageSize,
>(
  searchParams: URLSearchParams,
  defaults: Readonly<ServerTableHrefDefaults<TSortBy, TSortDirection, TPageSize>>,
  query: Readonly<ResolvedServerTableQuery<TSortBy, TSortDirection, TPageSize>>,
): void {
  appendOptionalDefaultedParam(searchParams, 'archiveState', query.archiveState, defaults.archiveState);
  appendTextParam(searchParams, 'q', query.searchQuery);
  appendDefaultedParam(searchParams, 'sortBy', query.sortBy, defaults.sortBy);
  appendDefaultedParam(searchParams, 'sortDirection', query.sortDirection, defaults.sortDirection);
  appendDefaultedNumberParam(searchParams, 'page', query.page, defaults.page);
  appendDefaultedNumberParam(searchParams, 'pageSize', query.pageSize, defaults.pageSize);
}

function appendOptionalDefaultedParam(
  searchParams: URLSearchParams,
  name: string,
  value: string | undefined,
  defaultValue: string | undefined,
): void {
  if (value !== undefined && value !== defaultValue) {
    searchParams.set(name, value);
  }
}

function appendTextParam(searchParams: URLSearchParams, name: string, value: string): void {
  if (hasText(value)) {
    searchParams.set(name, value);
  }
}

function appendDefaultedParam(searchParams: URLSearchParams, name: string, value: string, defaultValue: string): void {
  if (value !== defaultValue) {
    searchParams.set(name, value);
  }
}

function appendDefaultedNumberParam(
  searchParams: URLSearchParams,
  name: string,
  value: number,
  defaultValue: number,
): void {
  if (value !== defaultValue) {
    searchParams.set(name, String(value));
  }
}
