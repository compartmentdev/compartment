import type {
  AccessAssignmentScopeOptionsResponse,
  AccessAssignmentSummary,
  AccessGroupListPageResponse,
  AccessGroupMemberSummary,
  AccessRoleListRow,
} from '@compartment/contracts/browser';
import { useMemo } from 'react';
import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { type BrowserQueryFunctionContext, useSeedBrowserQueryData } from '../../lib/browser-query-client';
import type { BrowserGroupsPageResult } from '../../services/browser-groups.service.types';
import { browserAccessQueryStaleTime, requireBrowserAccessSelectedOrganizationSlug } from '../access/access-query';
import { canReadBrowserRoles } from '../console/console-access';
import {
  fetchAssignmentsResponse,
  fetchGroupsResponse,
  fetchRolesResponse,
  fetchScopeOptionsResponse,
  loadSelectedGroupMembers,
} from './groups-loader.requests';
import {
  readGroupsLoaderQuery,
  readInitialGroupsPageQueryData,
  readMergedGroupsPageData,
  type GroupsPageQueryData,
  type GroupsPageQueryResultData,
} from './groups-query-state.helpers';
import { readGroupsPageQueryKeys, type GroupsPageQueryKeys } from './groups-query-keys';
import type { GroupsLoaderQuery } from './groups-loader.query';

interface GroupsPageQueryInput {
  canReadRoles: boolean;
  hasOrganization: boolean;
  hasSelectedGroup: boolean;
  initialData: GroupsPageQueryData;
  keys: GroupsPageQueryKeys;
  organizationSlug: string | null;
  query: GroupsLoaderQuery;
  selectedGroupId: string | null;
}

interface GroupsPageQueryResults {
  assignments: UseQueryResult<{ assignments: AccessAssignmentSummary[] }>;
  groups: UseQueryResult<AccessGroupListPageResponse>;
  members: UseQueryResult<AccessGroupMemberSummary[]>;
  roles: UseQueryResult<{ roles: AccessRoleListRow[] }>;
  scopeOptions: UseQueryResult<AccessAssignmentScopeOptionsResponse>;
}

export function useGroupsPageQueryData(loaderData: BrowserGroupsPageResult): BrowserGroupsPageResult {
  const input: GroupsPageQueryInput = useGroupsPageQueryInput(loaderData);
  useSeedGroupsPageQueryData(input.keys, input.initialData);
  const results: GroupsPageQueryResults = useGroupsPageQueries(input);
  return useMergedGroupsPageData(loaderData, input.initialData, results);
}

function useGroupsPageQueryInput(loaderData: BrowserGroupsPageResult): GroupsPageQueryInput {
  const organizationSlug: string | null = loaderData.selectedOrganizationSlug;
  const query: GroupsLoaderQuery = useMemo((): GroupsLoaderQuery => readGroupsLoaderQuery(loaderData), [loaderData]);
  const keys: GroupsPageQueryKeys = useMemo(
    (): GroupsPageQueryKeys => readGroupsPageQueryKeys(organizationSlug, query, loaderData.selectedGroupId),
    [organizationSlug, query, loaderData.selectedGroupId],
  );
  const initialData: GroupsPageQueryData = useMemo(
    (): GroupsPageQueryData => readInitialGroupsPageQueryData(loaderData),
    [loaderData],
  );

  return {
    canReadRoles: canReadBrowserRoles(loaderData.currentOrganizationPermissions),
    hasOrganization: loaderData.selectedOrganizationSlug !== null,
    hasSelectedGroup: loaderData.selectedGroupId !== null,
    initialData,
    keys,
    organizationSlug,
    query,
    selectedGroupId: loaderData.selectedGroupId,
  };
}

function useSeedGroupsPageQueryData(keys: GroupsPageQueryKeys, initialData: GroupsPageQueryData): void {
  useSeedBrowserQueryData(keys.groups, initialData.groups);
  useSeedBrowserQueryData(keys.roles, initialData.roles);
  useSeedBrowserQueryData(keys.assignments, initialData.assignments);
  useSeedBrowserQueryData(keys.scopeOptions, initialData.scopeOptions);
  useSeedBrowserQueryData(keys.members, initialData.members);
}

function useGroupsPageQueries(input: GroupsPageQueryInput): GroupsPageQueryResults {
  return {
    assignments: useGroupsAssignmentsQuery(input),
    groups: useGroupsListQuery(input),
    members: useGroupsMembersQuery(input),
    roles: useGroupsRolesQuery(input),
    scopeOptions: useGroupsScopeOptionsQuery(input),
  };
}

function useGroupsListQuery(input: GroupsPageQueryInput): UseQueryResult<AccessGroupListPageResponse> {
  return useQuery({
    enabled: input.hasOrganization,
    initialData: input.initialData.groups,
    queryFn: async ({ signal }: BrowserQueryFunctionContext): Promise<AccessGroupListPageResponse> =>
      await fetchGroupsResponse(requireBrowserAccessSelectedOrganizationSlug(input.organizationSlug), input.query, {
        signal,
      }),
    queryKey: input.keys.groups,
    staleTime: browserAccessQueryStaleTime,
  });
}

function useGroupsRolesQuery(input: GroupsPageQueryInput): UseQueryResult<{ roles: AccessRoleListRow[] }> {
  return useQuery({
    enabled: input.hasOrganization && input.canReadRoles,
    initialData: input.initialData.roles,
    queryFn: async ({ signal }: BrowserQueryFunctionContext): Promise<{ roles: AccessRoleListRow[] }> =>
      await fetchRolesResponse(requireBrowserAccessSelectedOrganizationSlug(input.organizationSlug), { signal }),
    queryKey: input.keys.roles,
    staleTime: browserAccessQueryStaleTime,
  });
}

function useGroupsAssignmentsQuery(
  input: GroupsPageQueryInput,
): UseQueryResult<{ assignments: AccessAssignmentSummary[] }> {
  return useQuery({
    enabled: input.hasOrganization && input.canReadRoles,
    initialData: input.initialData.assignments,
    queryFn: async ({ signal }: BrowserQueryFunctionContext): Promise<{ assignments: AccessAssignmentSummary[] }> =>
      await fetchAssignmentsResponse(requireBrowserAccessSelectedOrganizationSlug(input.organizationSlug), { signal }),
    queryKey: input.keys.assignments,
    staleTime: browserAccessQueryStaleTime,
  });
}

function useGroupsScopeOptionsQuery(input: GroupsPageQueryInput): UseQueryResult<AccessAssignmentScopeOptionsResponse> {
  return useQuery({
    enabled: input.hasOrganization && input.canReadRoles,
    initialData: input.initialData.scopeOptions,
    queryFn: async ({ signal }: BrowserQueryFunctionContext): Promise<AccessAssignmentScopeOptionsResponse> =>
      await fetchScopeOptionsResponse(requireBrowserAccessSelectedOrganizationSlug(input.organizationSlug), { signal }),
    queryKey: input.keys.scopeOptions,
    staleTime: browserAccessQueryStaleTime,
  });
}

function useGroupsMembersQuery(input: GroupsPageQueryInput): UseQueryResult<AccessGroupMemberSummary[]> {
  return useQuery({
    enabled: input.hasOrganization && input.hasSelectedGroup,
    initialData: input.initialData.members,
    queryFn: async ({ signal }: BrowserQueryFunctionContext): Promise<AccessGroupMemberSummary[]> =>
      await loadSelectedGroupMembers(
        requireBrowserAccessSelectedOrganizationSlug(input.organizationSlug),
        input.selectedGroupId,
        { signal },
      ),
    queryKey: input.keys.members,
    staleTime: browserAccessQueryStaleTime,
  });
}

function useMergedGroupsPageData(
  loaderData: BrowserGroupsPageResult,
  initialData: GroupsPageQueryData,
  results: GroupsPageQueryResults,
): BrowserGroupsPageResult {
  const resultData: GroupsPageQueryResultData = {
    assignments: results.assignments.data,
    groups: results.groups.data,
    members: results.members.data,
    roles: results.roles.data,
    scopeOptions: results.scopeOptions.data,
  };

  return useMemo(
    (): BrowserGroupsPageResult => readMergedGroupsPageData(loaderData, initialData, resultData),
    [
      initialData,
      loaderData,
      results.assignments.data,
      results.groups.data,
      results.members.data,
      results.roles.data,
      results.scopeOptions.data,
    ],
  );
}
