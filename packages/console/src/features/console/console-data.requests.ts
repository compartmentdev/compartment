import {
  compartmentOrganizationListPathname,
  compartmentWhoAmIPathname,
  organizationListResponseSchema,
  projectListResponseSchema,
  whoamiResponseSchema,
  type OrganizationListResponse,
  type OrganizationSummary,
  type ProjectListResponse,
  type WhoAmIResponse,
} from '@compartment/contracts/browser';
import { requestBrowserApi, type BrowserApiRequestOptions } from '../../lib/browser-api';
import { projectsApiPathname } from '../../routes/projects/projects-api-paths';
import { requireProjectOverviewListResponse } from '../projects/project-list-response';
import type { BrowserConsoleWhoAmIQuery } from './console-data.types';

export type BrowserProjectCountArchiveState = 'active' | 'all';

export async function fetchBrowserProjectCount(
  currentOrganization: string,
  options: BrowserApiRequestOptions,
  archiveState: BrowserProjectCountArchiveState = 'active',
): Promise<number> {
  const response: ProjectListResponse = await requestBrowserApi(
    buildProjectCountPath(archiveState),
    projectListResponseSchema,
    {
      currentOrganization,
      signal: options.signal,
    },
  );
  return requireProjectOverviewListResponse(response).pagination.totalItems;
}

export async function fetchScopedWhoAmIResponse(
  selectedOrganizationSlug: string,
  query: Readonly<BrowserConsoleWhoAmIQuery>,
  options: BrowserApiRequestOptions,
): Promise<WhoAmIResponse> {
  return await requestBrowserApi(buildScopedWhoAmIPath(query), whoamiResponseSchema, {
    currentOrganization: selectedOrganizationSlug,
    signal: options.signal,
  });
}

export async function fetchConsoleOrganizations(options: BrowserApiRequestOptions): Promise<OrganizationSummary[]> {
  const response: OrganizationListResponse = await requestBrowserApi(
    compartmentOrganizationListPathname,
    organizationListResponseSchema,
    { signal: options.signal },
  );
  return sortOrganizations(response.organizations);
}

export async function fetchWhoAmIResponse(
  selectedOrganizationSlug: string | null,
  options: BrowserApiRequestOptions,
): Promise<WhoAmIResponse> {
  return await requestBrowserApi(compartmentWhoAmIPathname, whoamiResponseSchema, {
    currentOrganization: selectedOrganizationSlug ?? undefined,
    signal: options.signal,
  });
}

function sortOrganizations(organizations: OrganizationSummary[]): OrganizationSummary[] {
  return [...organizations].sort((left: OrganizationSummary, right: OrganizationSummary): number =>
    left.name.localeCompare(right.name),
  );
}

function buildProjectCountPath(archiveState: BrowserProjectCountArchiveState): string {
  const searchParams: URLSearchParams = new URLSearchParams({
    archiveState,
    detail: 'overview',
    orderBy: 'updatedAt',
    page: '1',
    perPage: '1',
    sort: 'desc',
  });
  return `${projectsApiPathname}?${searchParams.toString()}`;
}

function buildScopedWhoAmIPath(query: Readonly<BrowserConsoleWhoAmIQuery>): string {
  const searchParams: URLSearchParams = new URLSearchParams();
  if (query.environmentName !== undefined) {
    searchParams.set('environmentName', query.environmentName);
  }
  if (query.projectName !== undefined) {
    searchParams.set('projectName', query.projectName);
  }

  return searchParams.size === 0
    ? compartmentWhoAmIPathname
    : `${compartmentWhoAmIPathname}?${searchParams.toString()}`;
}
