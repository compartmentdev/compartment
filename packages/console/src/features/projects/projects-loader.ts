import {
  projectListResponseSchema,
  type PermissionKey,
  type ProjectListOrderBy,
  type ProjectListResponse,
} from '@compartment/contracts/browser';
import { redirect, type LoaderFunctionArgs } from 'react-router';
import { browserStartOnboardingSearchParamName } from '../../browser-public-paths';
import type {
  BrowserProjectsArchiveState,
  BrowserProjectsPageResult,
  BrowserProjectsPageSize,
  BrowserProjectsSortBy,
  BrowserProjectsSortDirection,
} from '../../services/browser-projects.service.types';
import type { BrowserOrganizationOption } from '../../services/browser-organization.service.types';
import type { BrowserConsoleOrganizationContext } from '../../services/browser-organization-context.service.types';
import { browserTablePageSizeOptions } from '../../services/browser-table.service.types';
import { projectsApiPathname } from '../../routes/projects/projects-api-paths';
import {
  loadBrowserConsoleContext,
  loadBrowserProjectCount,
  readBrowserErrorMessage,
  readBrowserNoticeMessage,
  writeBrowserConsoleListSearchParams,
  type BrowserConsoleContext,
} from '../console/console-data';
import { requestBrowserApi } from '../../lib/browser-api';
import { BrowserRedirect, readBrowserApiRedirect } from '../../lib/browser-redirect';
import { consumeBrowserLoginSuccessRedirect, readLoginSuccessRedirectTo } from '../auth/login-success-redirect';
import {
  readBrowserTablePageSize,
  readPositiveIntegerSearchParam,
  readTrimmedSearchParam,
} from '../../lib/server-table-query';
import { requireProjectOverviewListResponse, type BrowserProjectOverviewListResponse } from './project-list-response';
import { toBrowserProjectSummary } from './project-overview-loader.helpers';

interface ProjectsLoaderQuery {
  archiveState: BrowserProjectsArchiveState;
  errorMessage?: string | undefined;
  noticeMessage?: string | undefined;
  page: number;
  pageSize: BrowserProjectsPageSize;
  searchQuery: string;
  sortBy: BrowserProjectsSortBy;
  sortDirection: BrowserProjectsSortDirection;
  startOnboarding: boolean;
}

interface BrowserProjectsPageSharedFields {
  archiveState: BrowserProjectsArchiveState;
  currentOrganizationPermissions: PermissionKey[];
  errorMessage?: string | undefined;
  noticeMessage?: string | undefined;
  organizationContext: BrowserConsoleOrganizationContext;
  organizations: BrowserOrganizationOption[];
  pageSize: BrowserProjectsPageSize;
  pageSizeOptions: BrowserProjectsPageSize[];
  principalEmail: string;
  projectCount: number;
  searchQuery: string;
  selectedOrganizationSlug: string | null;
  showOrganizationSelector: boolean;
  sortBy: BrowserProjectsSortBy;
  sortDirection: BrowserProjectsSortDirection;
  startOnboarding: boolean;
}

export async function loadProjectsPageData({ request }: LoaderFunctionArgs): Promise<BrowserProjectsPageResult> {
  const url: URL = new URL(request.url);
  const loginSuccessRedirectTo: string | undefined = consumeBrowserLoginSuccessRedirect();
  if (loginSuccessRedirectTo !== undefined) {
    const currentUrl: string = readCurrentProjectsUrl(url);
    const nextRedirectTo: string = readLoginSuccessRedirectTo(currentUrl, loginSuccessRedirectTo);
    if (nextRedirectTo !== currentUrl) {
      return redirect(nextRedirectTo) as never;
    }
  }

  try {
    return await loadProjectsPageDataForUrl(url);
  } catch (error) {
    if (error instanceof BrowserRedirect) {
      return redirect(error.to) as never;
    }

    throw error;
  }
}

export async function loadProjectsPageDataForUrl(url: URL): Promise<BrowserProjectsPageResult> {
  const query: ProjectsLoaderQuery = readProjectsLoaderQuery(url.searchParams);
  const context: BrowserConsoleContext = await loadBrowserConsoleContext(
    url,
    {},
    {
      allowLegacyOrganizationQuery: false,
    },
  );

  return await loadProjectsPageDataForContext(context, query);
}

async function loadProjectsPageDataForContext(
  context: BrowserConsoleContext,
  query: ProjectsLoaderQuery,
): Promise<BrowserProjectsPageResult> {
  if (context.selectedOrganizationSlug === null) {
    return buildEmptyProjectsPageResult(context, query);
  }

  try {
    const [projectCount, response]: [number, ProjectListResponse] = await Promise.all([
      loadBrowserProjectCount(context.selectedOrganizationSlug, {}, 'all'),
      requestBrowserApi<ProjectListResponse>(buildProjectListPath(query), projectListResponseSchema, {
        currentOrganization: context.selectedOrganizationSlug,
      }),
    ]);

    return buildProjectsPageResult(context, query, projectCount, response);
  } catch (error) {
    if (error instanceof Error) {
      const apiRedirect: BrowserRedirect | null = readBrowserApiRedirect(error);
      if (apiRedirect !== null) {
        throw apiRedirect;
      }
    }
    throw error;
  }
}

function buildProjectListPath(query: ProjectsLoaderQuery): string {
  const searchParams: URLSearchParams = new URLSearchParams();
  searchParams.set('detail', 'overview');
  searchParams.set('archiveState', query.archiveState);
  searchParams.set('orderBy', mapProjectOrderBy(query.sortBy));
  writeBrowserConsoleListSearchParams(searchParams, query);

  return `${projectsApiPathname}?${searchParams.toString()}`;
}

function buildProjectsPageResult(
  context: BrowserConsoleContext,
  query: ProjectsLoaderQuery,
  projectCount: number,
  response: ProjectListResponse,
): BrowserProjectsPageResult {
  const overviewResponse: BrowserProjectOverviewListResponse = requireProjectOverviewListResponse(response);
  return {
    ...buildProjectsPageSharedFields(context, query, projectCount),
    page: overviewResponse.pagination.page,
    projects: overviewResponse.projects.map(toBrowserProjectSummary),
    totalPages: overviewResponse.pagination.totalPages,
    totalProjects: overviewResponse.pagination.totalItems,
  };
}

function buildEmptyProjectsPageResult(
  context: BrowserConsoleContext,
  query: ProjectsLoaderQuery,
): BrowserProjectsPageResult {
  return {
    ...buildProjectsPageSharedFields(context, query, 0),
    page: 1,
    projects: [],
    showOrganizationSelector: context.showOrganizationSelector,
    totalPages: 1,
    totalProjects: 0,
  };
}

function buildProjectsPageSharedFields(
  context: BrowserConsoleContext,
  query: ProjectsLoaderQuery,
  projectCount: number,
): BrowserProjectsPageSharedFields {
  return {
    archiveState: query.archiveState,
    currentOrganizationPermissions: context.currentOrganizationPermissions,
    errorMessage: query.errorMessage,
    noticeMessage: query.noticeMessage,
    organizationContext: context.organizationContext,
    organizations: context.organizations,
    pageSize: query.pageSize,
    pageSizeOptions: browserTablePageSizeOptions,
    principalEmail: context.principalEmail,
    projectCount,
    searchQuery: query.searchQuery,
    selectedOrganizationSlug: context.selectedOrganizationSlug,
    showOrganizationSelector: context.showOrganizationSelector,
    sortBy: query.sortBy,
    sortDirection: query.sortDirection,
    startOnboarding: query.startOnboarding,
  };
}

function readProjectsLoaderQuery(searchParams: URLSearchParams): ProjectsLoaderQuery {
  return {
    archiveState: readArchiveState(searchParams.get('archiveState')),
    errorMessage: readBrowserErrorMessage(searchParams.get('error')),
    noticeMessage: readBrowserNoticeMessage(searchParams.get('notice')),
    page: readPositiveIntegerSearchParam(searchParams.get('page'), 1),
    pageSize: readBrowserTablePageSize(searchParams.get('pageSize') ?? ''),
    searchQuery: readTrimmedSearchParam(searchParams, 'q'),
    sortBy: readSortBy(searchParams.get('sortBy')),
    sortDirection: readSortDirection(searchParams.get('sortDirection'), 'desc'),
    startOnboarding: searchParams.has(browserStartOnboardingSearchParamName),
  };
}

function readCurrentProjectsUrl(url: URL): string {
  const search: string = url.searchParams.toString();
  return search === '' ? url.pathname : `${url.pathname}?${search}`;
}

function mapProjectOrderBy(sortBy: BrowserProjectsSortBy): ProjectListOrderBy {
  switch (sortBy) {
    case 'lastDeploy':
      return 'lastDeploymentCreatedAt';
    case 'project':
      return 'name';
    case 'services':
      return 'serviceCount';
    case 'status':
      return 'status';
    case 'updated':
      return 'updatedAt';
  }
}

function readArchiveState(value: string | null): BrowserProjectsArchiveState {
  switch (value) {
    case null:
      return 'active';
    case 'all':
    case 'archived':
      return value;
    default:
      return 'active';
  }
}

function readSortBy(value: string | null): BrowserProjectsSortBy {
  switch (value) {
    case null:
      return 'updated';
    case 'lastDeploy':
    case 'project':
    case 'services':
    case 'status':
    case 'updated':
      return value;
    default:
      return 'updated';
  }
}

function readSortDirection(value: string | null, fallback: BrowserProjectsSortDirection): BrowserProjectsSortDirection {
  return value === 'asc' || value === 'desc' ? value : fallback;
}
