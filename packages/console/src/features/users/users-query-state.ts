import type {
  AccessAssignmentScopeOptionsResponse,
  AccessGroupListResponse,
  AccessRoleListResponse,
  UserAccessDetailResponse,
  UserListResponse,
} from '@compartment/contracts/browser';
import { useMemo } from 'react';
import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { type BrowserQueryFunctionContext, useSeedBrowserQueryData } from '../../lib/browser-query-client';
import type { BrowserUsersPageResult } from '../../services/browser-users.service.types';
import { browserAccessQueryStaleTime, requireBrowserAccessSelectedOrganizationSlug } from '../access/access-query';
import { canReadBrowserGroups, canReadBrowserRoles } from '../console/console-access';
import {
  fetchGroupsPageResponse,
  fetchRolesPageResponse,
  fetchScopeOptionsResponse,
  fetchUserAccessResponse,
  fetchUsersPageResponse,
  type UsersLoaderQuery,
} from './users-loader.helpers';
import {
  readInitialUsersPageQueryData,
  readUsersLoaderQueryFromPage,
  type UsersPageQueryData,
} from './users-query-state.helpers';
import { readUsersPageQueryKeys, type UsersPageQueryKeys } from './users-query-keys';

interface UsersPageQueryFlags {
  canLoadGroups: boolean;
  canLoadRoles: boolean;
  hasOrganization: boolean;
  hasSelectedUser: boolean;
}

interface UsersPageQueryInput {
  flags: UsersPageQueryFlags;
  initialData: UsersPageQueryData;
  keys: UsersPageQueryKeys;
  organizationSlug: string | null;
  query: UsersLoaderQuery;
  selectedUserEmail: string | null;
}

interface UsersPageQueryResults {
  access: UseQueryResult<UserAccessDetailResponse | undefined>;
  groups: UseQueryResult<AccessGroupListResponse>;
  roles: UseQueryResult<AccessRoleListResponse>;
  scopeOptions: UseQueryResult<AccessAssignmentScopeOptionsResponse>;
  users: UseQueryResult<UserListResponse>;
}

export function useUsersPageQueryData(loaderData: BrowserUsersPageResult): BrowserUsersPageResult {
  const input: UsersPageQueryInput = useUsersPageQueryInput(loaderData);
  useSeedUsersPageQueryData(input.keys, input.initialData);
  const results: UsersPageQueryResults = useUsersPageQueries(input);
  return useMergedUsersPageData(loaderData, input.initialData, results);
}

function useUsersPageQueryInput(loaderData: BrowserUsersPageResult): UsersPageQueryInput {
  const organizationSlug: string | null = loaderData.selectedOrganizationSlug;
  const query: UsersLoaderQuery = useMemo(
    (): UsersLoaderQuery => readUsersLoaderQueryFromPage(loaderData),
    [loaderData],
  );
  const flags: UsersPageQueryFlags = useMemo(
    (): UsersPageQueryFlags => readUsersPageQueryFlags(loaderData),
    [loaderData],
  );
  const keys: UsersPageQueryKeys = useMemo(
    (): UsersPageQueryKeys => readUsersPageQueryKeys(organizationSlug, query),
    [organizationSlug, query],
  );
  const initialData: UsersPageQueryData = useMemo(
    (): UsersPageQueryData => readInitialUsersPageQueryData(loaderData),
    [loaderData],
  );

  return { flags, initialData, keys, organizationSlug, query, selectedUserEmail: loaderData.selectedUserEmail };
}

function useSeedUsersPageQueryData(keys: UsersPageQueryKeys, initialData: UsersPageQueryData): void {
  useSeedBrowserQueryData(keys.users, initialData.users);
  useSeedBrowserQueryData(keys.roles, initialData.roles);
  useSeedBrowserQueryData(keys.groups, initialData.groups);
  useSeedBrowserQueryData(keys.scopeOptions, initialData.scopeOptions);
  useSeedBrowserQueryData(keys.access, initialData.access);
}

function useUsersPageQueries(input: UsersPageQueryInput): UsersPageQueryResults {
  return {
    access: useUserAccessQuery(input),
    groups: useUserGroupsQuery(input),
    roles: useUserRolesQuery(input),
    scopeOptions: useUserScopeOptionsQuery(input),
    users: useUsersListQuery(input),
  };
}

function useUsersListQuery(input: UsersPageQueryInput): UseQueryResult<UserListResponse> {
  return useQuery({
    enabled: input.flags.hasOrganization,
    initialData: input.initialData.users,
    queryFn: async ({ signal }: BrowserQueryFunctionContext): Promise<UserListResponse> =>
      await fetchUsersPageResponse(input.query, requireBrowserAccessSelectedOrganizationSlug(input.organizationSlug), {
        signal,
      }),
    queryKey: input.keys.users,
    staleTime: browserAccessQueryStaleTime,
  });
}

function useUserRolesQuery(input: UsersPageQueryInput): UseQueryResult<AccessRoleListResponse> {
  return useQuery({
    enabled: input.flags.hasOrganization && input.flags.canLoadRoles,
    initialData: input.initialData.roles,
    queryFn: async ({ signal }: BrowserQueryFunctionContext): Promise<AccessRoleListResponse> =>
      await fetchRolesPageResponse(requireBrowserAccessSelectedOrganizationSlug(input.organizationSlug), { signal }),
    queryKey: input.keys.roles,
    staleTime: browserAccessQueryStaleTime,
  });
}

function useUserGroupsQuery(input: UsersPageQueryInput): UseQueryResult<AccessGroupListResponse> {
  return useQuery({
    enabled: input.flags.hasOrganization && input.flags.canLoadGroups,
    initialData: input.initialData.groups,
    queryFn: async ({ signal }: BrowserQueryFunctionContext): Promise<AccessGroupListResponse> =>
      await fetchGroupsPageResponse(requireBrowserAccessSelectedOrganizationSlug(input.organizationSlug), { signal }),
    queryKey: input.keys.groups,
    staleTime: browserAccessQueryStaleTime,
  });
}

function useUserScopeOptionsQuery(input: UsersPageQueryInput): UseQueryResult<AccessAssignmentScopeOptionsResponse> {
  return useQuery({
    enabled: input.flags.hasOrganization && input.flags.canLoadRoles,
    initialData: input.initialData.scopeOptions,
    queryFn: async ({ signal }: BrowserQueryFunctionContext): Promise<AccessAssignmentScopeOptionsResponse> =>
      await fetchScopeOptionsResponse(requireBrowserAccessSelectedOrganizationSlug(input.organizationSlug), { signal }),
    queryKey: input.keys.scopeOptions,
    staleTime: browserAccessQueryStaleTime,
  });
}

function useUserAccessQuery(input: UsersPageQueryInput): UseQueryResult<UserAccessDetailResponse | undefined> {
  return useQuery({
    enabled: input.flags.hasOrganization && input.flags.hasSelectedUser,
    initialData: input.initialData.access,
    queryFn: async ({ signal }: BrowserQueryFunctionContext): Promise<UserAccessDetailResponse | undefined> =>
      input.selectedUserEmail === null
        ? undefined
        : await fetchUserAccessResponse(
            input.selectedUserEmail,
            requireBrowserAccessSelectedOrganizationSlug(input.organizationSlug),
            { signal },
          ),
    queryKey: input.keys.access,
    staleTime: browserAccessQueryStaleTime,
  });
}

function useMergedUsersPageData(
  loaderData: BrowserUsersPageResult,
  initialData: UsersPageQueryData,
  results: UsersPageQueryResults,
): BrowserUsersPageResult {
  return useMemo(
    (): BrowserUsersPageResult => readMergedUsersPageData(loaderData, initialData, results),
    [
      initialData,
      loaderData,
      results.access.data,
      results.groups.data,
      results.roles.data,
      results.scopeOptions.data,
      results.users.data,
    ],
  );
}

function readMergedUsersPageData(
  loaderData: BrowserUsersPageResult,
  initialData: UsersPageQueryData,
  results: UsersPageQueryResults,
): BrowserUsersPageResult {
  const users: UserListResponse = results.users.data ?? initialData.users;
  const roles: AccessRoleListResponse = results.roles.data ?? initialData.roles;
  const groups: AccessGroupListResponse = results.groups.data ?? initialData.groups;
  const scopeOptions: AccessAssignmentScopeOptionsResponse = results.scopeOptions.data ?? initialData.scopeOptions;
  const access: UserAccessDetailResponse | undefined = results.access.data ?? initialData.access;

  return {
    ...loaderData,
    availableGroups: groups.groups,
    availableRoles: roles.roles,
    page: users.pagination.page,
    scopeProjects: scopeOptions.projects,
    selectedUserAccess: access?.access ?? null,
    totalPages: users.pagination.totalPages,
    totalUsers: users.pagination.totalItems,
    users: users.users,
  };
}

function readUsersPageQueryFlags(data: BrowserUsersPageResult): UsersPageQueryFlags {
  return {
    canLoadGroups: canReadBrowserGroups(data.currentOrganizationPermissions),
    canLoadRoles: canReadBrowserRoles(data.currentOrganizationPermissions),
    hasOrganization: data.selectedOrganizationSlug !== null,
    hasSelectedUser: data.mode === 'detail' && data.selectedUserEmail !== null,
  };
}
