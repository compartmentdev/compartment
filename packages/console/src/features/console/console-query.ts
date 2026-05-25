import { type QueryKey } from '@tanstack/react-query';
import type { BrowserApiRequestOptions } from '../../lib/browser-api';
import { browserQueryClient, invalidateBrowserQueries, loadBrowserQueryData } from '../../lib/browser-query-client';

interface BrowserConsoleQueryOptions<TData> {
  options: BrowserApiRequestOptions;
  queryKey: QueryKey;
  request: BrowserConsoleQueryRequest<TData>;
}

type BrowserConsoleQueryRequest<TData> = (options: BrowserApiRequestOptions) => Promise<TData>;

const browserConsoleContextQueryStaleTime: number = Number.POSITIVE_INFINITY;

export function readBrowserConsoleOrganizationsQueryKey(): QueryKey {
  return ['console-context', 'organizations'];
}

export function readBrowserConsoleProjectCountQueryKey(
  organizationSlug: string,
  archiveState: 'active' | 'all' = 'active',
): QueryKey {
  return ['console-context', 'project-count', organizationSlug, archiveState];
}

export async function invalidateBrowserConsolePermissionQueries(organizationSlug: string): Promise<void> {
  await invalidateBrowserQueries(browserQueryClient, readBrowserConsoleWhoAmIQueryKey(organizationSlug));
}

export function readBrowserConsoleWhoAmIQueryKey(organizationSlug: string | null): QueryKey {
  return ['console-context', 'whoami', organizationSlug];
}

export function readBrowserConsoleScopedWhoAmIQueryKey(
  organizationSlug: string,
  projectName: string | undefined,
  environmentName: string | undefined,
): QueryKey {
  return ['console-context', 'whoami', organizationSlug, 'scope', projectName ?? null, environmentName ?? null];
}

export async function loadBrowserConsoleQueryData<TData>({
  options,
  queryKey,
  request,
}: BrowserConsoleQueryOptions<TData>): Promise<TData> {
  return await loadBrowserQueryData({
    options,
    queryKey,
    request,
    staleTime: browserConsoleContextQueryStaleTime,
  });
}
