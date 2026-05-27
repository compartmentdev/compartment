import type {
  AccessAssignmentScopeOptionsResponse,
  AccessAssignmentSummary,
  AccessGroupListResponse,
  AccessGroupMemberSummary,
  AccessGroupSummary,
  AccessRoleListRow,
} from '@compartment/contracts/browser';
import { useMemo } from 'react';
import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import {
  type BrowserQueryFunctionContext,
  browserQueryClient,
  invalidateBrowserQueries,
  useSeedBrowserQueryData,
} from '../../lib/browser-query-client';
import type { BrowserGroupsPageResult } from '../../services/browser-groups.service.types';
import {
  browserAccessQueryStaleTime,
  readAccessGroupsOrganizationQueryKey,
  readAccessRolesListQueryKey,
  readAccessUsersOrganizationQueryKey,
  requireBrowserAccessSelectedOrganizationSlug,
} from '../access/access-query';
import { canReadBrowserRoles } from '../console/console-access';
import { invalidateBrowserConsolePermissionQueries } from '../console/console-query';
import {
  fetchAssignmentsResponse,
  fetchGroupsResponse,
  fetchRolesResponse,
  fetchScopeOptionsResponse,
  loadSelectedGroupMembers,
} from './groups-loader.requests';
import { readGroupsPageQueryKeys, type GroupsPageQueryKeys } from './groups-query-keys';

interface GroupsPageQueryData {
  assignments: { assignments: AccessAssignmentSummary[] };
  groups: AccessGroupListResponse;
  members: AccessGroupMemberSummary[];
  roles: { roles: AccessRoleListRow[] };
  scopeOptions: AccessAssignmentScopeOptionsResponse;
}

interface GroupsPageQueryInput {
  canReadRoles: boolean;
  hasOrganization: boolean;
  hasSelectedGroup: boolean;
  initialData: GroupsPageQueryData;
  keys: GroupsPageQueryKeys;
  organizationSlug: string | null;
  selectedGroupId: string | null;
}

interface GroupsPageQueryResults {
  assignments: UseQueryResult<{ assignments: AccessAssignmentSummary[] }>;
  groups: UseQueryResult<AccessGroupListResponse>;
  members: UseQueryResult<AccessGroupMemberSummary[]>;
  roles: UseQueryResult<{ roles: AccessRoleListRow[] }>;
  scopeOptions: UseQueryResult<AccessAssignmentScopeOptionsResponse>;
}

type GroupsPageMode = 'create' | 'detail' | 'list';

export function useGroupsPageQueryData(loaderData: BrowserGroupsPageResult): BrowserGroupsPageResult {
  const input: GroupsPageQueryInput = useGroupsPageQueryInput(loaderData);
  useSeedGroupsPageQueryData(input.keys, input.initialData);
  const results: GroupsPageQueryResults = useGroupsPageQueries(input);
  return useMergedGroupsPageData(loaderData, input.initialData, results);
}

function useGroupsPageQueryInput(loaderData: BrowserGroupsPageResult): GroupsPageQueryInput {
  const organizationSlug: string | null = loaderData.selectedOrganizationSlug;
  const keys: GroupsPageQueryKeys = useMemo(
    (): GroupsPageQueryKeys => readGroupsPageQueryKeys(organizationSlug, loaderData.selectedGroupId),
    [organizationSlug, loaderData.selectedGroupId],
  );
  const initialData: GroupsPageQueryData = useMemo(
    (): GroupsPageQueryData => readInitialGroupsPageQueryData(loaderData),
    [loaderData.assignments, loaderData.groups, loaderData.members, loaderData.roles, loaderData.scopeProjects],
  );
  const hasOrganization: boolean = loaderData.selectedOrganizationSlug !== null;
  const hasSelectedGroup: boolean = loaderData.selectedGroupId !== null;
  const canReadRoles: boolean = canReadBrowserRoles(loaderData.currentOrganizationPermissions);

  return {
    canReadRoles,
    hasOrganization,
    hasSelectedGroup,
    initialData,
    keys,
    organizationSlug,
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

function useGroupsListQuery(input: GroupsPageQueryInput): UseQueryResult<AccessGroupListResponse> {
  return useQuery({
    enabled: input.hasOrganization,
    initialData: input.initialData.groups,
    queryFn: async ({ signal }: BrowserQueryFunctionContext): Promise<AccessGroupListResponse> =>
      await fetchGroupsResponse(requireBrowserAccessSelectedOrganizationSlug(input.organizationSlug), { signal }),
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
  return useMemo(
    (): BrowserGroupsPageResult => readMergedGroupsPageData(loaderData, initialData, results),
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

function readMergedGroupsPageData(
  loaderData: BrowserGroupsPageResult,
  initialData: GroupsPageQueryData,
  results: GroupsPageQueryResults,
): BrowserGroupsPageResult {
  const groups: AccessGroupListResponse = readMergedGroupsResponse(loaderData, initialData.groups, results.groups.data);
  const nextSelectedGroupId: string | null = readNextSelectedGroupId(loaderData.selectedGroupId, groups);
  return {
    ...loaderData,
    assignments: (results.assignments.data ?? initialData.assignments).assignments,
    groups: groups.groups,
    members: nextSelectedGroupId === null ? [] : (results.members.data ?? initialData.members),
    mode: readNextGroupsMode(loaderData.mode, nextSelectedGroupId),
    roles: (results.roles.data ?? initialData.roles).roles,
    scopeProjects: (results.scopeOptions.data ?? initialData.scopeOptions).projects,
    selectedGroupId: nextSelectedGroupId,
  };
}

function readMergedGroupsResponse(
  loaderData: BrowserGroupsPageResult,
  initialGroups: AccessGroupListResponse,
  cachedGroups: AccessGroupListResponse | undefined,
): AccessGroupListResponse {
  if (cachedGroups === undefined) {
    return initialGroups;
  }

  return shouldPreferLoaderGroups(loaderData.selectedGroupId, cachedGroups, initialGroups)
    ? initialGroups
    : cachedGroups;
}

export async function invalidateGroupsAccessQueries(data: BrowserGroupsPageResult): Promise<void> {
  if (data.selectedOrganizationSlug === null) {
    return;
  }

  await Promise.all([
    invalidateBrowserConsolePermissionQueries(data.selectedOrganizationSlug),
    invalidateBrowserQueries(browserQueryClient, readAccessGroupsOrganizationQueryKey(data.selectedOrganizationSlug)),
    invalidateBrowserQueries(browserQueryClient, readAccessRolesListQueryKey(data.selectedOrganizationSlug)),
    invalidateBrowserQueries(browserQueryClient, readAccessUsersOrganizationQueryKey(data.selectedOrganizationSlug)),
  ]);
}

function readInitialGroupsPageQueryData(data: BrowserGroupsPageResult): GroupsPageQueryData {
  return {
    assignments: { assignments: data.assignments },
    groups: { groups: data.groups },
    members: data.members,
    roles: { roles: data.roles },
    scopeOptions: { projects: data.scopeProjects },
  };
}

function shouldPreferLoaderGroups(
  selectedGroupId: string | null,
  cachedGroups: AccessGroupListResponse,
  loaderGroups: AccessGroupListResponse,
): boolean {
  return (
    selectedGroupId !== null &&
    readNextSelectedGroupId(selectedGroupId, cachedGroups) === null &&
    readNextSelectedGroupId(selectedGroupId, loaderGroups) !== null
  );
}

function readNextSelectedGroupId(selectedGroupId: string | null, response: AccessGroupListResponse): string | null {
  return selectedGroupId !== null &&
    response.groups.some((group: AccessGroupSummary): boolean => group.id === selectedGroupId)
    ? selectedGroupId
    : null;
}

function readNextGroupsMode(currentMode: GroupsPageMode, selectedGroupId: string | null): GroupsPageMode {
  if (currentMode === 'create') {
    return 'create';
  }

  return selectedGroupId === null ? 'list' : 'detail';
}
