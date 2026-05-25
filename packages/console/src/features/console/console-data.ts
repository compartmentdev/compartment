import { type OrganizationSummary, type PermissionKey, type WhoAmIResponse } from '@compartment/contracts/browser';
import { hasText } from '@compartment/utils';
import type { BrowserApiRequestOptions } from '../../lib/browser-api';
import { BrowserRedirect, readBrowserApiRedirect } from '../../lib/browser-redirect';
import { normalizeBrowserSearchQuery } from '../../lib/search-query';
import { deploymentDetailsUnavailableErrorCode } from '../deployment-history/deployment-history-error';
import type { BrowserConsoleOrganizationContext } from '../../services/browser-organization-context.service.types';
import {
  type BrowserProjectCountArchiveState,
  fetchBrowserProjectCount,
  fetchConsoleOrganizations,
  fetchScopedWhoAmIResponse,
  fetchWhoAmIResponse,
} from './console-data.requests';
import type { BrowserConsoleWhoAmIQuery } from './console-data.types';
import {
  loadBrowserConsoleQueryData,
  readBrowserConsoleOrganizationsQueryKey,
  readBrowserConsoleProjectCountQueryKey,
  readBrowserConsoleScopedWhoAmIQueryKey,
  readBrowserConsoleWhoAmIQueryKey,
} from './console-query';
import {
  readBrowserConsoleOrganizationRouteResolution,
  readBrowserConsoleRouteInput,
  type BrowserConsoleOrganizationRouteOptions,
  type BrowserConsoleRouteInput,
  type BrowserConsoleOrganizationRouteResolution,
} from './console-organization-route';

export interface BrowserConsoleContext {
  currentOrganizationPermissions: PermissionKey[];
  organizationContext: BrowserConsoleOrganizationContext;
  organizations: OrganizationSummary[];
  principalEmail: string;
  selectedOrganizationSlug: string | null;
  showOrganizationSelector: boolean;
}

interface BrowserConsoleEnvironmentPermissionScope {
  environmentName: string;
  projectName: string;
}

interface BrowserConsoleListQuery {
  page: number;
  pageSize: number;
  searchQuery: string;
  sortDirection: string;
}

const browserNoticeMessages: Readonly<Record<string, string>> = {
  audit_read_required: 'You need audit log access to view audit logs.',
  project_archived: 'Project archived.',
  project_removed: 'Project removed.',
  project_start_queued: 'Queued project start.',
  project_stopped: 'Project stopped.',
  project_unarchived: 'Project unarchived.',
  user_removed: 'User removed.',
  user_role_updated: 'Role updated.',
  users_admin_required: 'You need organization admin access to manage users.',
};

export async function loadBrowserConsoleContext(
  input: URL,
  options: BrowserApiRequestOptions = {},
  routeOptions: BrowserConsoleOrganizationRouteOptions = {},
): Promise<BrowserConsoleContext> {
  try {
    return await buildBrowserConsoleContext(readBrowserConsoleRouteInput(input), options, routeOptions);
  } catch (error) {
    if (error instanceof Error) {
      const apiRedirect: Error | null = readBrowserApiRedirect(error);
      if (apiRedirect !== null) {
        throw apiRedirect;
      }
    }

    throw error;
  }
}

export async function loadBrowserEnvironmentPermissions(
  selectedOrganizationSlug: string | null,
  scope: Readonly<BrowserConsoleEnvironmentPermissionScope> | null,
  options: BrowserApiRequestOptions = {},
): Promise<PermissionKey[]> {
  if (selectedOrganizationSlug === null || scope === null) {
    return [];
  }

  const whoami: WhoAmIResponse = await loadScopedWhoAmIResponse(selectedOrganizationSlug, scope, options);
  return whoami.currentOrganizationPermissions;
}

export async function loadSidebarProjectCount(
  currentOrganization: string,
  options: BrowserApiRequestOptions = {},
): Promise<number> {
  try {
    return await loadBrowserProjectCount(currentOrganization, options);
  } catch (error) {
    if ((error instanceof Error && error.name === 'AbortError') || options.signal?.aborted === true) {
      throw error;
    }

    return 0;
  }
}

export async function loadBrowserProjectCount(
  currentOrganization: string,
  options: BrowserApiRequestOptions = {},
  archiveState: BrowserProjectCountArchiveState = 'active',
): Promise<number> {
  return await loadBrowserConsoleQueryData({
    options,
    queryKey: readBrowserConsoleProjectCountQueryKey(currentOrganization, archiveState),
    request: async (queryOptions: BrowserApiRequestOptions): Promise<number> =>
      await fetchBrowserProjectCount(currentOrganization, queryOptions, archiveState),
  });
}

async function loadScopedWhoAmIResponse(
  selectedOrganizationSlug: string,
  query: Readonly<BrowserConsoleWhoAmIQuery>,
  options: BrowserApiRequestOptions,
): Promise<WhoAmIResponse> {
  return await loadBrowserConsoleQueryData({
    options,
    queryKey: readBrowserConsoleScopedWhoAmIQueryKey(
      selectedOrganizationSlug,
      query.projectName,
      query.environmentName,
    ),
    request: async (queryOptions: BrowserApiRequestOptions): Promise<WhoAmIResponse> =>
      await fetchScopedWhoAmIResponse(selectedOrganizationSlug, query, queryOptions),
  });
}

export function writeBrowserConsoleListSearchParams(
  searchParams: URLSearchParams,
  query: BrowserConsoleListQuery,
): void {
  searchParams.set('sort', query.sortDirection);
  searchParams.set('page', String(query.page));
  searchParams.set('perPage', String(query.pageSize));
  const searchQuery: string = normalizeBrowserSearchQuery(query.searchQuery);
  if (hasText(searchQuery)) {
    searchParams.set('search', searchQuery);
  }
}

export function readBrowserNoticeMessage(value: string | null): string | undefined {
  return value === null ? undefined : browserNoticeMessages[value];
}

export function readBrowserErrorMessage(value: string | null): string | undefined {
  switch (value) {
    case null:
      return undefined;
    case deploymentDetailsUnavailableErrorCode:
      return 'Deployment details are not available yet.';
    case 'project_overview_environment_required':
      return 'Choose an environment before opening deployments.';
    case 'project_action_failed':
      return 'Project action failed.';
    case 'user_action_failed':
      return 'User action failed.';
    default:
      return undefined;
  }
}

async function buildBrowserConsoleContext(
  routeInput: BrowserConsoleRouteInput,
  options: BrowserApiRequestOptions,
  routeOptions: BrowserConsoleOrganizationRouteOptions,
): Promise<BrowserConsoleContext> {
  const organizations: OrganizationSummary[] = await loadConsoleOrganizations(options);
  const routeResolution: BrowserConsoleOrganizationRouteResolution = readBrowserConsoleRouteResolutionOrThrow(
    routeInput,
    organizations,
    routeOptions,
  );
  const organizationContext: BrowserConsoleOrganizationContext = routeResolution.organizationContext;
  const selectedOrganizationSlug: string | null = organizationContext.selectedOrganizationSlug;
  const whoami: WhoAmIResponse = await loadWhoAmIResponse(selectedOrganizationSlug, options);
  return {
    currentOrganizationPermissions: whoami.currentOrganizationPermissions,
    organizationContext,
    organizations,
    principalEmail: whoami.principal.email,
    selectedOrganizationSlug,
    showOrganizationSelector: organizations.length > 1,
  };
}

function readBrowserConsoleRouteResolutionOrThrow(
  routeInput: BrowserConsoleRouteInput,
  organizations: OrganizationSummary[],
  routeOptions: BrowserConsoleOrganizationRouteOptions,
): BrowserConsoleOrganizationRouteResolution {
  const routeResolution: BrowserConsoleOrganizationRouteResolution = readBrowserConsoleOrganizationRouteResolution(
    routeInput,
    organizations,
    routeOptions,
  );
  if (routeResolution.redirectTo !== null) {
    throw new BrowserRedirect(routeResolution.redirectTo);
  }

  return routeResolution;
}

async function loadConsoleOrganizations(options: BrowserApiRequestOptions): Promise<OrganizationSummary[]> {
  return await loadBrowserConsoleQueryData({
    options,
    queryKey: readBrowserConsoleOrganizationsQueryKey(),
    request: fetchConsoleOrganizations,
  });
}

async function loadWhoAmIResponse(
  selectedOrganizationSlug: string | null,
  options: BrowserApiRequestOptions,
): Promise<WhoAmIResponse> {
  return await loadBrowserConsoleQueryData({
    options,
    queryKey: readBrowserConsoleWhoAmIQueryKey(selectedOrganizationSlug),
    request: async (queryOptions: BrowserApiRequestOptions): Promise<WhoAmIResponse> =>
      await fetchWhoAmIResponse(selectedOrganizationSlug, queryOptions),
  });
}
