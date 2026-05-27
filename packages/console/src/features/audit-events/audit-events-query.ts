import {
  appendDefaultedNumberParam,
  appendDefaultedParam,
  appendTextParam,
  readNextServerTableSortDirection,
  type ServerTableHrefOverrides,
} from '../../lib/server-table-query';
import type {
  BrowserAuditEventFilters,
  BrowserAuditEventsPageResult,
  BrowserAuditEventsPageSize,
  BrowserAuditEventsSortBy,
  BrowserAuditEventsSortDirection,
  BrowserAuditEventTypeFilter,
} from '../../services/browser-audit-events.service.types';
import { browserAuditPathname, buildBrowserOrganizationScopedPathname } from '../../browser-public-paths';

interface AuditEventsHrefOverrides extends ServerTableHrefOverrides<
  BrowserAuditEventsSortBy,
  BrowserAuditEventsSortDirection,
  BrowserAuditEventsPageSize
> {
  actor?: string | undefined;
  eventType?: BrowserAuditEventTypeFilter | undefined;
  from?: string | undefined;
  project?: string | undefined;
  targetType?: string | undefined;
  to?: string | undefined;
}

interface AuditEventsHrefQuery {
  filters: BrowserAuditEventFilters;
  page: number;
  pageSize: BrowserAuditEventsPageSize;
  selectedOrganizationSlug: string | null;
  sortBy: BrowserAuditEventsSortBy;
  sortDirection: BrowserAuditEventsSortDirection;
}

const defaultAuditEventsPage: number = 1;
const defaultAuditEventsPageSize: BrowserAuditEventsPageSize = 10;
const defaultAuditEventsSortBy: BrowserAuditEventsSortBy = 'occurredAt';
const defaultAuditEventsSortDirection: BrowserAuditEventsSortDirection = 'desc';

export function buildAuditEventsHref(
  data: Readonly<BrowserAuditEventsPageResult>,
  overrides: Readonly<AuditEventsHrefOverrides> = {},
): string {
  const query: AuditEventsHrefQuery = resolveAuditEventsHrefQuery(data, overrides);
  const searchParams: URLSearchParams = buildAuditEventsSearchParams(query);

  return buildAuditEventsPathname(searchParams, query.selectedOrganizationSlug);
}

export function buildAuditEventsResetHref(data: Readonly<BrowserAuditEventsPageResult>): string {
  return data.selectedOrganizationSlug === null
    ? browserAuditPathname
    : buildBrowserOrganizationScopedPathname(data.selectedOrganizationSlug, browserAuditPathname);
}

export function readNextAuditEventsSortDirection(
  data: Readonly<BrowserAuditEventsPageResult>,
  sortBy: BrowserAuditEventsSortBy,
): BrowserAuditEventsSortDirection {
  return readNextServerTableSortDirection(
    data.sortBy,
    data.sortDirection,
    sortBy,
    sortBy === 'occurredAt' ? 'desc' : 'asc',
  );
}

function buildAuditEventsSearchParams(query: AuditEventsHrefQuery): URLSearchParams {
  const searchParams: URLSearchParams = new URLSearchParams();
  appendAuditFilterParams(searchParams, query.filters);
  appendDefaultedParam(searchParams, 'sortBy', query.sortBy, defaultAuditEventsSortBy);
  appendDefaultedParam(searchParams, 'sortDirection', query.sortDirection, defaultAuditEventsSortDirection);
  appendDefaultedNumberParam(searchParams, 'page', query.page, defaultAuditEventsPage);
  appendDefaultedNumberParam(searchParams, 'pageSize', query.pageSize, defaultAuditEventsPageSize);

  return searchParams;
}

function resolveAuditEventsHrefQuery(
  data: Readonly<BrowserAuditEventsPageResult>,
  overrides: Readonly<AuditEventsHrefOverrides>,
): AuditEventsHrefQuery {
  return {
    filters: {
      actor: overrides.actor ?? data.filters.actor,
      eventType: overrides.eventType ?? data.filters.eventType,
      from: overrides.from ?? data.filters.from,
      project: overrides.project ?? data.filters.project,
      targetType: overrides.targetType ?? data.filters.targetType,
      to: overrides.to ?? data.filters.to,
    },
    page: overrides.page ?? data.page,
    pageSize: overrides.pageSize ?? data.pageSize,
    selectedOrganizationSlug:
      overrides.selectedOrganizationSlug === undefined
        ? data.selectedOrganizationSlug
        : overrides.selectedOrganizationSlug,
    sortBy: overrides.sortBy ?? data.sortBy,
    sortDirection: overrides.sortDirection ?? data.sortDirection,
  };
}

function appendAuditFilterParams(searchParams: URLSearchParams, filters: BrowserAuditEventFilters): void {
  appendTextParam(searchParams, 'from', filters.from);
  appendTextParam(searchParams, 'to', filters.to);
  appendTextParam(searchParams, 'eventType', filters.eventType);
  appendTextParam(searchParams, 'actor', filters.actor);
  appendTextParam(searchParams, 'targetType', filters.targetType);
  appendTextParam(searchParams, 'project', filters.project);
}

function buildAuditEventsPathname(searchParams: URLSearchParams, selectedOrganizationSlug: string | null): string {
  const queryString: string = searchParams.toString();
  const pathname: string =
    selectedOrganizationSlug === null
      ? browserAuditPathname
      : buildBrowserOrganizationScopedPathname(selectedOrganizationSlug, browserAuditPathname);

  return queryString === '' ? pathname : `${pathname}?${queryString}`;
}
