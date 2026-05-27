import type { AccessRoleListPageResponse, AccessRoleResponse, AccessRoleSummary } from '@compartment/contracts/browser';
import { useMemo } from 'react';
import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import {
  type BrowserQueryFunctionContext,
  browserQueryClient,
  invalidateBrowserQueries,
  useSeedBrowserQueryData,
} from '../../lib/browser-query-client';
import type { BrowserRolesPageResult } from '../../services/browser-roles.service.types';
import {
  browserAccessQueryStaleTime,
  readAccessGroupsOrganizationQueryKey,
  readAccessRolesOrganizationQueryKey,
  readAccessUsersOrganizationQueryKey,
  requireBrowserAccessSelectedOrganizationSlug,
} from '../access/access-query';
import { invalidateBrowserConsolePermissionQueries } from '../console/console-query';
import { fetchRolesResponse, readSelectedRole, type RolesLoaderQuery } from './roles-loader';
import { useInitialRolesPageQueryData, useRolesPageQueryKeys } from './roles-query-state.helpers';
import type { RolesPageQueryData, RolesPageQueryKeys } from './roles-query-state.types';

interface RolesPageQueryInput {
  hasOrganization: boolean;
  hasSelectedRole: boolean;
  initialData: RolesPageQueryData;
  keys: RolesPageQueryKeys;
  organizationSlug: string | null;
  query: RolesLoaderQuery;
  roleId: string | null;
}

interface RolesPageQueryResults {
  role: UseQueryResult<AccessRoleResponse | undefined>;
  roles: UseQueryResult<AccessRoleListPageResponse>;
}

type RolesPageMode = 'create' | 'detail' | 'edit' | 'list';

export function useRolesPageQueryData(loaderData: BrowserRolesPageResult): BrowserRolesPageResult {
  const input: RolesPageQueryInput = useRolesPageQueryInput(loaderData);
  useSeedRolesPageQueryData(input.keys, input.initialData);
  const results: RolesPageQueryResults = useRolesPageQueries(input);
  return useMergedRolesPageData(loaderData, input.initialData, results);
}

function useRolesPageQueryInput(loaderData: BrowserRolesPageResult): RolesPageQueryInput {
  const organizationSlug: string | null = loaderData.selectedOrganizationSlug;
  const roleId: string | null = loaderData.roleId;
  const query: RolesLoaderQuery = useMemo((): RolesLoaderQuery => readRolesLoaderQuery(loaderData), [loaderData]);
  const keys: RolesPageQueryKeys = useRolesPageQueryKeys(organizationSlug, query, roleId);
  const initialData: RolesPageQueryData = useInitialRolesPageQueryData(loaderData);

  return {
    hasOrganization: organizationSlug !== null,
    hasSelectedRole: roleId !== null,
    initialData,
    keys,
    organizationSlug,
    query,
    roleId,
  };
}

function useSeedRolesPageQueryData(keys: RolesPageQueryKeys, initialData: RolesPageQueryData): void {
  useSeedBrowserQueryData(keys.roles, initialData.roles);
  useSeedBrowserQueryData(keys.role, initialData.role);
}

function useRolesPageQueries(input: RolesPageQueryInput): RolesPageQueryResults {
  return {
    role: useRoleDetailQuery(input),
    roles: useRolesListQuery(input),
  };
}

function useRolesListQuery(input: RolesPageQueryInput): UseQueryResult<AccessRoleListPageResponse> {
  return useQuery({
    enabled: input.hasOrganization,
    initialData: input.initialData.roles,
    queryFn: async ({ signal }: BrowserQueryFunctionContext): Promise<AccessRoleListPageResponse> =>
      await fetchRolesResponse(requireBrowserAccessSelectedOrganizationSlug(input.organizationSlug), input.query, {
        signal,
      }),
    queryKey: input.keys.roles,
    staleTime: browserAccessQueryStaleTime,
  });
}

function useRoleDetailQuery(input: RolesPageQueryInput): UseQueryResult<AccessRoleResponse | undefined> {
  return useQuery({
    enabled: input.hasOrganization && input.hasSelectedRole,
    initialData: input.initialData.role,
    queryFn: async ({ signal }: BrowserQueryFunctionContext): Promise<AccessRoleResponse | undefined> =>
      input.roleId === null
        ? undefined
        : ((await readSelectedRole(requireBrowserAccessSelectedOrganizationSlug(input.organizationSlug), input.roleId, {
            signal,
          })) ?? undefined),
    queryKey: input.keys.role,
    staleTime: browserAccessQueryStaleTime,
  });
}

function useMergedRolesPageData(
  loaderData: BrowserRolesPageResult,
  initialData: RolesPageQueryData,
  results: RolesPageQueryResults,
): BrowserRolesPageResult {
  return useMemo(
    (): BrowserRolesPageResult => readMergedRolesPageData(loaderData, initialData, results),
    [initialData, loaderData, results.role.data, results.roles.data],
  );
}

function readMergedRolesPageData(
  loaderData: BrowserRolesPageResult,
  initialData: RolesPageQueryData,
  results: RolesPageQueryResults,
): BrowserRolesPageResult {
  const roles: AccessRoleListPageResponse = results.roles.data ?? initialData.roles;
  const role: AccessRoleResponse | undefined = results.role.data ?? initialData.role;
  const nextRoleId: string | null = readNextRoleId(loaderData.roleId, roles, role);
  return {
    ...loaderData,
    mode: readNextRolesMode(loaderData.mode, nextRoleId),
    page: roles.pagination.page,
    role: nextRoleId === null ? null : (role?.role ?? null),
    roleId: nextRoleId,
    roles: roles.roles,
    totalPages: roles.pagination.totalPages,
    totalRoles: roles.pagination.totalItems,
  };
}

export async function invalidateRoleAccessQueries(data: BrowserRolesPageResult): Promise<void> {
  if (data.selectedOrganizationSlug === null) {
    return;
  }

  await Promise.all([
    invalidateBrowserConsolePermissionQueries(data.selectedOrganizationSlug),
    invalidateBrowserQueries(browserQueryClient, readAccessRolesOrganizationQueryKey(data.selectedOrganizationSlug)),
    invalidateBrowserQueries(browserQueryClient, readAccessGroupsOrganizationQueryKey(data.selectedOrganizationSlug)),
    invalidateBrowserQueries(browserQueryClient, readAccessUsersOrganizationQueryKey(data.selectedOrganizationSlug)),
  ]);
}

function readNextRoleId(
  roleId: string | null,
  response: AccessRoleListPageResponse,
  role: AccessRoleResponse | undefined,
): string | null {
  if (roleId === null) {
    return null;
  }

  return response.roles.some((item: AccessRoleSummary): boolean => item.id === roleId) || role?.role.id === roleId
    ? roleId
    : null;
}

function readNextRolesMode(currentMode: RolesPageMode, roleId: string | null): RolesPageMode {
  if (currentMode === 'create') {
    return 'create';
  }
  if (currentMode === 'edit' && roleId !== null) {
    return 'edit';
  }

  return roleId === null ? 'list' : 'detail';
}

function readRolesLoaderQuery(loaderData: BrowserRolesPageResult): RolesLoaderQuery {
  return {
    page: loaderData.page,
    pageSize: loaderData.pageSize,
    searchQuery: loaderData.searchQuery,
    sortBy: loaderData.sortBy,
    sortDirection: loaderData.sortDirection,
  };
}
