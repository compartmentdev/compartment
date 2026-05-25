import type { AccessRoleListResponse, AccessRoleResponse, AccessRoleSummary } from '@compartment/contracts/browser';
import { useMemo } from 'react';
import { type QueryKey, type UseQueryResult, useQuery } from '@tanstack/react-query';
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
  readAccessOrganizationUnavailableQueryKey,
  readAccessRolesDetailQueryKey,
  readAccessRolesListQueryKey,
  readAccessRolesOrganizationQueryKey,
  readAccessUsersOrganizationQueryKey,
  requireBrowserAccessSelectedOrganizationSlug,
} from '../access/access-query';
import { invalidateBrowserConsolePermissionQueries } from '../console/console-query';
import { fetchRolesResponse, readSelectedRole } from './roles-loader';

interface RolesPageQueryData {
  role: AccessRoleResponse | undefined;
  roles: AccessRoleListResponse;
}

interface RolesPageQueryKeys {
  role: QueryKey;
  roles: QueryKey;
}

interface RolesPageQueryInput {
  hasOrganization: boolean;
  hasSelectedRole: boolean;
  initialData: RolesPageQueryData;
  keys: RolesPageQueryKeys;
  organizationSlug: string | null;
  roleId: string | null;
}

interface RolesPageQueryResults {
  role: UseQueryResult<AccessRoleResponse | undefined>;
  roles: UseQueryResult<AccessRoleListResponse>;
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
  const keys: RolesPageQueryKeys = useMemo(
    (): RolesPageQueryKeys => readRolesPageQueryKeys(organizationSlug, loaderData.roleId),
    [organizationSlug, loaderData.roleId],
  );
  const initialData: RolesPageQueryData = useMemo(
    (): RolesPageQueryData => readInitialRolesPageQueryData(loaderData),
    [loaderData.role, loaderData.roles],
  );
  const hasOrganization: boolean = loaderData.selectedOrganizationSlug !== null;
  const hasSelectedRole: boolean = loaderData.roleId !== null;

  return { hasOrganization, hasSelectedRole, initialData, keys, organizationSlug, roleId: loaderData.roleId };
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

function useRolesListQuery(input: RolesPageQueryInput): UseQueryResult<AccessRoleListResponse> {
  return useQuery({
    enabled: input.hasOrganization,
    initialData: input.initialData.roles,
    queryFn: async ({ signal }: BrowserQueryFunctionContext): Promise<AccessRoleListResponse> =>
      await fetchRolesResponse(requireBrowserAccessSelectedOrganizationSlug(input.organizationSlug), { signal }),
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
  const roles: AccessRoleListResponse = results.roles.data ?? initialData.roles;
  const nextRoleId: string | null = readNextRoleId(loaderData.roleId, roles);
  return {
    ...loaderData,
    mode: readNextRolesMode(loaderData.mode, nextRoleId),
    role: nextRoleId === null ? null : ((results.role.data ?? initialData.role)?.role ?? null),
    roleId: nextRoleId,
    roles: roles.roles,
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

function readRolesPageQueryKeys(organizationSlug: string | null, roleId: string | null): RolesPageQueryKeys {
  if (organizationSlug === null) {
    return readRolesPageOrganizationUnavailableQueryKeys(roleId);
  }

  return {
    role: readRolesDetailQueryKey(organizationSlug, roleId),
    roles: readAccessRolesListQueryKey(organizationSlug),
  };
}

function readRolesDetailQueryKey(organizationSlug: string, roleId: string | null): QueryKey {
  return roleId === null
    ? ['console-access', 'roles', organizationSlug, 'detail', 'unselected']
    : readAccessRolesDetailQueryKey(organizationSlug, roleId);
}

function readRolesPageOrganizationUnavailableQueryKeys(roleId: string | null): RolesPageQueryKeys {
  return {
    role: readAccessOrganizationUnavailableQueryKey('roles', 'detail', roleId ?? 'unselected'),
    roles: readAccessOrganizationUnavailableQueryKey('roles', 'list'),
  };
}

function readInitialRolesPageQueryData(data: BrowserRolesPageResult): RolesPageQueryData {
  return {
    role: data.role === null ? undefined : { role: data.role },
    roles: { roles: data.roles },
  };
}

function readNextRoleId(roleId: string | null, response: AccessRoleListResponse): string | null {
  if (roleId === null) {
    return null;
  }

  return response.roles.some((role: AccessRoleSummary): boolean => role.id === roleId) ? roleId : null;
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
