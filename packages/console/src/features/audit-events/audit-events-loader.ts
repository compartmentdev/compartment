import {
  auditEventListResponseSchema,
  auditEventTypeOptions,
  compartmentAuditEventsPathname,
  type AuditEventListResponse,
  type AuditEventType,
} from '@compartment/contracts/browser';
import { hasText } from '@compartment/utils';
import { redirect, type LoaderFunctionArgs } from 'react-router';
import type {
  BrowserAuditEventFilters,
  BrowserAuditEventsPageResult,
  BrowserAuditEventsPageSize,
  BrowserAuditEventsSortBy,
  BrowserAuditEventsSortDirection,
} from '../../services/browser-audit-events.service.types';
import { browserTablePageSizeOptions } from '../../services/browser-table.service.types';
import { requestBrowserApi } from '../../lib/browser-api';
import { BrowserRedirect, readBrowserApiRedirect } from '../../lib/browser-redirect';
import {
  readBrowserTablePageSize,
  readPositiveIntegerSearchParam,
  readTrimmedSearchParam,
} from '../../lib/server-table-query';
import { loadBrowserConsoleContext, type BrowserConsoleContext } from '../console/console-data';
import { buildAuditReadRequiredRedirectTarget, canReadBrowserAuditLogs } from '../console/console-access';

interface AuditEventsLoaderQuery {
  filters: BrowserAuditEventFilters;
  page: number;
  pageSize: BrowserAuditEventsPageSize;
  sortBy: BrowserAuditEventsSortBy;
  sortDirection: BrowserAuditEventsSortDirection;
}

export async function loadAuditEventsPageData({ request }: LoaderFunctionArgs): Promise<BrowserAuditEventsPageResult> {
  const url: URL = new URL(request.url);

  try {
    return await loadAuditEventsPageDataForUrl(url);
  } catch (error) {
    if (error instanceof BrowserRedirect) {
      return redirect(error.to) as never;
    }

    throw error;
  }
}

async function loadAuditEventsPageDataForUrl(url: URL): Promise<BrowserAuditEventsPageResult> {
  const query: AuditEventsLoaderQuery = readAuditEventsLoaderQuery(url.searchParams);
  const context: BrowserConsoleContext = await loadBrowserConsoleContext(
    url,
    {},
    {
      allowLegacyOrganizationQuery: false,
    },
  );
  if (context.selectedOrganizationSlug === null) {
    return buildEmptyAuditEventsPageResult(context, query);
  }
  const auditReadRequiredRedirectTarget: string = buildAuditReadRequiredRedirectTarget(
    context.selectedOrganizationSlug,
  );
  if (!canReadBrowserAuditLogs(context.currentOrganizationPermissions)) {
    throw new BrowserRedirect(auditReadRequiredRedirectTarget);
  }

  return await loadSelectedOrganizationAuditEventsPageData(
    context,
    query,
    context.selectedOrganizationSlug,
    auditReadRequiredRedirectTarget,
  );
}

function readAuditEventsLoaderQuery(searchParams: URLSearchParams): AuditEventsLoaderQuery {
  return {
    filters: {
      actor: readTrimmedSearchParam(searchParams, 'actor'),
      eventType: readAuditEventType(searchParams.get('eventType')),
      from: readTrimmedSearchParam(searchParams, 'from'),
      project: readTrimmedSearchParam(searchParams, 'project'),
      targetType: readTrimmedSearchParam(searchParams, 'targetType'),
      to: readTrimmedSearchParam(searchParams, 'to'),
    },
    page: readPositiveIntegerSearchParam(searchParams.get('page'), 1),
    pageSize: readBrowserTablePageSize(searchParams.get('pageSize') ?? ''),
    sortBy: readAuditEventsSortBy(searchParams.get('sortBy')),
    sortDirection: readAuditEventsSortDirection(searchParams.get('sortDirection')),
  };
}

async function loadSelectedOrganizationAuditEventsPageData(
  context: BrowserConsoleContext,
  query: AuditEventsLoaderQuery,
  organizationSlug: string,
  auditReadRequiredRedirectTarget: string,
): Promise<BrowserAuditEventsPageResult> {
  try {
    return buildAuditEventsPageResult(context, query, await fetchAuditEventsPageResponse(query, organizationSlug));
  } catch (error) {
    if (error instanceof Error) {
      throw readBrowserApiRedirect(error, auditReadRequiredRedirectTarget) ?? error;
    }

    throw error;
  }
}

function buildAuditEventsPageResult(
  context: BrowserConsoleContext,
  query: AuditEventsLoaderQuery,
  response: AuditEventListResponse,
): BrowserAuditEventsPageResult {
  return {
    currentOrganizationPermissions: context.currentOrganizationPermissions,
    events: response.events,
    filters: query.filters,
    organizationContext: context.organizationContext,
    organizations: context.organizations,
    page: response.pagination.page,
    pageSize: query.pageSize,
    pageSizeOptions: browserTablePageSizeOptions,
    principalEmail: context.principalEmail,
    selectedOrganizationSlug: context.selectedOrganizationSlug,
    showOrganizationSelector: context.showOrganizationSelector,
    sortBy: query.sortBy,
    sortDirection: query.sortDirection,
    totalEvents: response.pagination.totalItems,
    totalPages: response.pagination.totalPages,
  };
}

function buildEmptyAuditEventsPageResult(
  context: BrowserConsoleContext,
  query: AuditEventsLoaderQuery,
): BrowserAuditEventsPageResult {
  return {
    currentOrganizationPermissions: context.currentOrganizationPermissions,
    events: [],
    filters: query.filters,
    organizationContext: context.organizationContext,
    organizations: context.organizations,
    page: 1,
    pageSize: query.pageSize,
    pageSizeOptions: browserTablePageSizeOptions,
    principalEmail: context.principalEmail,
    selectedOrganizationSlug: null,
    showOrganizationSelector: context.showOrganizationSelector,
    sortBy: query.sortBy,
    sortDirection: query.sortDirection,
    totalEvents: 0,
    totalPages: 1,
  };
}

async function fetchAuditEventsPageResponse(
  query: AuditEventsLoaderQuery,
  organizationSlug: string,
): Promise<AuditEventListResponse> {
  return await requestBrowserApi<AuditEventListResponse>(
    buildAuditEventsListPath(query),
    auditEventListResponseSchema,
    {
      currentOrganization: organizationSlug,
    },
  );
}

function buildAuditEventsListPath(query: AuditEventsLoaderQuery): string {
  const searchParams: URLSearchParams = new URLSearchParams();
  searchParams.set('orderBy', query.sortBy);
  searchParams.set('page', String(query.page));
  searchParams.set('perPage', String(query.pageSize));
  searchParams.set('sort', query.sortDirection);
  appendTextParam(searchParams, 'actor', query.filters.actor);
  appendTextParam(searchParams, 'eventType', query.filters.eventType);
  appendApiDateTimeParam(searchParams, 'from', query.filters.from);
  appendTextParam(searchParams, 'project', query.filters.project);
  appendTextParam(searchParams, 'targetType', query.filters.targetType);
  appendApiDateTimeParam(searchParams, 'to', query.filters.to);

  return `${compartmentAuditEventsPathname}?${searchParams.toString()}`;
}

function appendTextParam(searchParams: URLSearchParams, name: string, value: string): void {
  if (hasText(value)) {
    searchParams.set(name, value);
  }
}

function appendApiDateTimeParam(searchParams: URLSearchParams, name: string, value: string): void {
  const apiDateTime: string | undefined = readApiDateTime(value);
  if (apiDateTime !== undefined) {
    searchParams.set(name, apiDateTime);
  }
}

function readApiDateTime(value: string): string | undefined {
  if (!hasText(value)) {
    return undefined;
  }
  const date: Date = new Date(value);

  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function readAuditEventType(value: string | null): AuditEventType | '' {
  if (value === null) {
    return '';
  }

  return auditEventTypeOptions.includes(value as AuditEventType) ? (value as AuditEventType) : '';
}

function readAuditEventsSortBy(value: string | null): BrowserAuditEventsSortBy {
  switch (value) {
    case 'eventType':
    case 'status':
      return value;
    case null:
    default:
      return 'occurredAt';
  }
}

function readAuditEventsSortDirection(value: string | null): BrowserAuditEventsSortDirection {
  return value === 'asc' ? 'asc' : 'desc';
}
