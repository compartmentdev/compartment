import { browserGroupsPathname, buildBrowserOrganizationScopedPathname } from '../../browser-public-paths';
import {
  appendDefaultedNumberParam,
  appendDefaultedParam,
  appendTextParam,
  readNextServerTableSortDirection,
  type ServerTableHrefOverrides,
} from '../../lib/server-table-query';
import type {
  BrowserGroupsPageResult,
  BrowserGroupsPageSize,
  BrowserGroupsSortBy,
  BrowserGroupsSortDirection,
} from '../../services/browser-groups.service.types';

type GroupsPageMode = 'create' | 'detail' | 'list';

interface GroupsPageHrefContext {
  page?: number | undefined;
  pageSize?: BrowserGroupsPageSize | undefined;
  searchQuery?: string | undefined;
  selectedOrganizationSlug: string | null;
  sortBy?: BrowserGroupsSortBy | undefined;
  sortDirection?: BrowserGroupsSortDirection | undefined;
}

interface GroupsHrefInput {
  groupId?: string | null | undefined;
  mode?: GroupsPageMode | undefined;
  organizationSlug: string | null;
  page?: number | undefined;
  pageSize?: BrowserGroupsPageSize | undefined;
  searchQuery?: string | undefined;
  sortBy?: BrowserGroupsSortBy | undefined;
  sortDirection?: BrowserGroupsSortDirection | undefined;
}

type GroupsHrefOverrides = ServerTableHrefOverrides<
  BrowserGroupsSortBy,
  BrowserGroupsSortDirection,
  BrowserGroupsPageSize
> & {
  groupId?: string | null | undefined;
  mode?: GroupsPageMode | undefined;
};

const defaultGroupsPage: number = 1;
const defaultGroupsPageSize: BrowserGroupsPageSize = 10;
const defaultGroupsSortBy: BrowserGroupsSortBy = 'name';
const defaultGroupsSortDirection: BrowserGroupsSortDirection = 'asc';

export function buildGroupsPageHref(
  context: GroupsPageHrefContext,
  groupId?: string | null,
  mode: GroupsPageMode = 'list',
  overrides: GroupsHrefOverrides = {},
): string {
  return buildGroupsHref(readGroupsPageHrefInput(context, groupId, mode, overrides));
}

export function buildGroupsHref(
  organizationSlug: string | null,
  groupId?: string | null,
  mode?: GroupsPageMode,
  overrides?: Omit<GroupsHrefInput, 'groupId' | 'mode' | 'organizationSlug'>,
): string;
export function buildGroupsHref(input: GroupsHrefInput): string;
export function buildGroupsHref(
  inputOrOrganizationSlug: GroupsHrefInput | string | null,
  groupId?: string | null,
  mode: GroupsPageMode = 'list',
  overrides: Omit<GroupsHrefInput, 'groupId' | 'mode' | 'organizationSlug'> = {},
): string {
  const input: GroupsHrefInput = readGroupsHrefInput(inputOrOrganizationSlug, groupId, mode, overrides);
  const searchParams: URLSearchParams = new URLSearchParams();
  appendGroupsQueryParams(searchParams, input);

  const query: string = searchParams.toString();
  const pathname: string = readGroupsPathname(input.organizationSlug);
  return query === '' ? pathname : `${pathname}?${query}`;
}

export function readNextGroupsSortDirection(
  data: BrowserGroupsPageResult,
  sortBy: BrowserGroupsSortBy,
): BrowserGroupsSortDirection {
  return readNextServerTableSortDirection(
    data.sortBy,
    data.sortDirection,
    sortBy,
    sortBy === 'assignmentCount' || sortBy === 'memberCount' ? 'desc' : 'asc',
  );
}

function appendGroupsQueryParams(searchParams: URLSearchParams, input: GroupsHrefInput): void {
  appendTextParam(searchParams, 'q', input.searchQuery ?? '');
  appendDefaultedParam(searchParams, 'sortBy', input.sortBy ?? defaultGroupsSortBy, defaultGroupsSortBy);
  appendDefaultedParam(
    searchParams,
    'sortDirection',
    input.sortDirection ?? defaultGroupsSortDirection,
    defaultGroupsSortDirection,
  );
  appendDefaultedNumberParam(searchParams, 'page', input.page ?? defaultGroupsPage, defaultGroupsPage);
  appendDefaultedNumberParam(searchParams, 'pageSize', input.pageSize ?? defaultGroupsPageSize, defaultGroupsPageSize);
  if (input.groupId !== null && input.groupId !== undefined) {
    searchParams.set('groupId', input.groupId);
  }
  if (input.mode === 'create') {
    searchParams.set('mode', 'create');
  }
}

function readGroupsPageHrefInput(
  context: GroupsPageHrefContext,
  groupId: string | null | undefined,
  mode: GroupsPageMode,
  overrides: GroupsHrefOverrides,
): GroupsHrefInput {
  return {
    groupId: overrides.groupId ?? groupId ?? null,
    mode: overrides.mode ?? mode,
    organizationSlug: overrides.selectedOrganizationSlug ?? context.selectedOrganizationSlug,
    page: overrides.page ?? context.page ?? defaultGroupsPage,
    pageSize: overrides.pageSize ?? context.pageSize ?? defaultGroupsPageSize,
    searchQuery: overrides.searchQuery ?? context.searchQuery ?? '',
    sortBy: overrides.sortBy ?? context.sortBy ?? defaultGroupsSortBy,
    sortDirection: overrides.sortDirection ?? context.sortDirection ?? defaultGroupsSortDirection,
  };
}

function readGroupsHrefInput(
  inputOrOrganizationSlug: GroupsHrefInput | string | null,
  groupId: string | null | undefined,
  mode: GroupsPageMode,
  overrides: Omit<GroupsHrefInput, 'groupId' | 'mode' | 'organizationSlug'>,
): GroupsHrefInput {
  if (typeof inputOrOrganizationSlug === 'object' && inputOrOrganizationSlug !== null) {
    return inputOrOrganizationSlug;
  }

  return {
    ...overrides,
    groupId: groupId ?? null,
    mode,
    organizationSlug: inputOrOrganizationSlug,
  };
}

function readGroupsPathname(organizationSlug: string | null): string {
  return organizationSlug === null
    ? browserGroupsPathname
    : buildBrowserOrganizationScopedPathname(organizationSlug, browserGroupsPathname);
}
