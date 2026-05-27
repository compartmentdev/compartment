import type {
  AccessAssignmentScopeProjectOption,
  AccessAssignmentScopeOptionsResponse,
  AccessAssignmentSummary,
  AccessGroupListPageResponse,
  AccessGroupListRow,
  AccessGroupMemberSummary,
  AccessGroupSummary,
  AccessRoleListRow,
} from '@compartment/contracts/browser';
import type { BrowserGroupsPageResult } from '../../services/browser-groups.service.types';
import type { GroupsLoaderQuery } from './groups-loader.query';

export interface GroupsPageQueryData {
  assignments: { assignments: AccessAssignmentSummary[] };
  groups: AccessGroupListPageResponse;
  members: AccessGroupMemberSummary[];
  roles: { roles: AccessRoleListRow[] };
  scopeOptions: AccessAssignmentScopeOptionsResponse;
}

export interface GroupsPageQueryResultData {
  assignments: { assignments: AccessAssignmentSummary[] } | undefined;
  groups: AccessGroupListPageResponse | undefined;
  members: AccessGroupMemberSummary[] | undefined;
  roles: { roles: AccessRoleListRow[] } | undefined;
  scopeOptions: AccessAssignmentScopeOptionsResponse | undefined;
}

type GroupsPageMode = 'create' | 'detail' | 'list';
interface MergedGroupsPageCollections {
  assignments: AccessAssignmentSummary[];
  members: AccessGroupMemberSummary[];
  roles: AccessRoleListRow[];
  scopeProjects: AccessAssignmentScopeProjectOption[];
}

interface MergedGroupsPageState {
  groups: AccessGroupListRow[];
  mode: GroupsPageMode;
  page: number;
  selectedGroup: AccessGroupListRow | null;
  selectedGroupId: string | null;
  totalGroups: number;
  totalPages: number;
}

export function readInitialGroupsPageQueryData(data: BrowserGroupsPageResult): GroupsPageQueryData {
  return {
    assignments: { assignments: data.assignments },
    groups: {
      detail: 'list',
      groups: data.groups,
      pagination: {
        page: data.page,
        perPage: data.pageSize,
        totalItems: data.totalGroups,
        totalPages: data.totalPages,
      },
    },
    members: data.members,
    roles: { roles: data.roles },
    scopeOptions: { projects: data.scopeProjects },
  };
}

export function readMergedGroupsPageData(
  loaderData: BrowserGroupsPageResult,
  initialData: GroupsPageQueryData,
  results: GroupsPageQueryResultData,
): BrowserGroupsPageResult {
  const groups: AccessGroupListPageResponse = readMergedGroupsResponse(loaderData, initialData.groups, results.groups);
  const nextSelectedGroupId: string | null = readNextSelectedGroupId(
    loaderData.selectedGroupId,
    groups,
    loaderData.selectedGroup,
  );
  const collections: MergedGroupsPageCollections = readMergedGroupsPageCollections(
    initialData,
    results,
    nextSelectedGroupId,
  );
  return {
    ...loaderData,
    assignments: collections.assignments,
    ...readMergedGroupsPageState(loaderData, groups, nextSelectedGroupId),
    members: collections.members,
    roles: collections.roles,
    scopeProjects: collections.scopeProjects,
  };
}

function readMergedGroupsPageCollections(
  initialData: GroupsPageQueryData,
  results: GroupsPageQueryResultData,
  selectedGroupId: string | null,
): MergedGroupsPageCollections {
  return {
    assignments: (results.assignments ?? initialData.assignments).assignments,
    members: selectedGroupId === null ? [] : (results.members ?? initialData.members),
    roles: (results.roles ?? initialData.roles).roles,
    scopeProjects: (results.scopeOptions ?? initialData.scopeOptions).projects,
  };
}

function readMergedGroupsPageState(
  loaderData: BrowserGroupsPageResult,
  groups: AccessGroupListPageResponse,
  nextSelectedGroupId: string | null,
): MergedGroupsPageState {
  return {
    groups: groups.groups,
    mode: readNextGroupsMode(loaderData.mode, nextSelectedGroupId),
    page: groups.pagination.page,
    selectedGroup: readSelectedGroup(loaderData.selectedGroup, groups, nextSelectedGroupId),
    selectedGroupId: nextSelectedGroupId,
    totalGroups: groups.pagination.totalItems,
    totalPages: groups.pagination.totalPages,
  };
}

export function readGroupsLoaderQuery(loaderData: BrowserGroupsPageResult): GroupsLoaderQuery {
  return {
    page: loaderData.page,
    pageSize: loaderData.pageSize,
    searchQuery: loaderData.searchQuery,
    sortBy: loaderData.sortBy,
    sortDirection: loaderData.sortDirection,
  };
}

function readMergedGroupsResponse(
  loaderData: BrowserGroupsPageResult,
  initialGroups: AccessGroupListPageResponse,
  cachedGroups: AccessGroupListPageResponse | undefined,
): AccessGroupListPageResponse {
  if (cachedGroups === undefined) {
    return initialGroups;
  }

  return shouldPreferLoaderGroups(loaderData.selectedGroupId, cachedGroups, initialGroups)
    ? initialGroups
    : cachedGroups;
}

function shouldPreferLoaderGroups(
  selectedGroupId: string | null,
  cachedGroups: AccessGroupListPageResponse,
  loaderGroups: AccessGroupListPageResponse,
): boolean {
  return (
    selectedGroupId !== null &&
    readNextSelectedGroupId(selectedGroupId, cachedGroups, null) === null &&
    readNextSelectedGroupId(selectedGroupId, loaderGroups, null) !== null
  );
}

function readNextSelectedGroupId(
  selectedGroupId: string | null,
  response: AccessGroupListPageResponse,
  selectedGroup: AccessGroupListRow | null | undefined,
): string | null {
  const hasSelectedGroupMatch: boolean = selectedGroupId !== null && selectedGroup?.id === selectedGroupId;

  return selectedGroupId !== null &&
    (response.groups.some((group: AccessGroupSummary): boolean => group.id === selectedGroupId) ||
      hasSelectedGroupMatch)
    ? selectedGroupId
    : null;
}

function readSelectedGroup(
  selectedGroup: AccessGroupListRow | null | undefined,
  response: AccessGroupListPageResponse,
  selectedGroupId: string | null,
): AccessGroupListRow | null {
  if (selectedGroupId === null) {
    return null;
  }
  if (selectedGroup?.id === selectedGroupId) {
    return selectedGroup;
  }

  return response.groups.find((group: AccessGroupSummary): boolean => group.id === selectedGroupId) ?? null;
}

function readNextGroupsMode(currentMode: GroupsPageMode, selectedGroupId: string | null): GroupsPageMode {
  if (currentMode === 'create') {
    return 'create';
  }

  return selectedGroupId === null ? 'list' : 'detail';
}
