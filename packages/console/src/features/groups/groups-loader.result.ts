import type {
  AccessAssignmentListResponse,
  AccessAssignmentScopeOptionsResponse,
  AccessAssignmentSummary,
  AccessGroupListPageResponse,
  AccessGroupListRow,
  AccessGroupMemberSummary,
  AccessGroupResponse,
  AccessGroupSummary,
  AccessRoleListResponse,
} from '@compartment/contracts/browser';
import type { BrowserGroupsPageResult } from '../../services/browser-groups.service.types';
import { browserTablePageSizeOptions } from '../../services/browser-table.service.types';
import { readBrowserErrorMessage, readBrowserNoticeMessage, type BrowserConsoleContext } from '../console/console-data';
import type { GroupsLoaderQuery } from './groups-loader.query';

export interface GroupsPageResponses {
  assignmentsResponse: AccessAssignmentListResponse;
  groupsResponse: AccessGroupListPageResponse;
  rolesResponse: AccessRoleListResponse;
  selectedGroupResponse: AccessGroupResponse | null;
  scopeOptionsResponse: AccessAssignmentScopeOptionsResponse;
}

type BrowserGroupsPageBaseResult = Omit<
  BrowserGroupsPageResult,
  | 'assignments'
  | 'groups'
  | 'members'
  | 'mode'
  | 'page'
  | 'pageSize'
  | 'pageSizeOptions'
  | 'projectCount'
  | 'roles'
  | 'scopeProjects'
  | 'selectedGroup'
  | 'selectedGroupId'
  | 'selectedOrganizationSlug'
  | 'totalGroups'
  | 'totalPages'
>;
type GroupsPageListResult = Pick<
  BrowserGroupsPageResult,
  'assignments' | 'groups' | 'page' | 'roles' | 'scopeProjects' | 'totalGroups' | 'totalPages'
>;
type GroupsPageMode = 'create' | 'detail' | 'list';
type AccessGroupAssignmentValueReader = (assignment: AccessAssignmentSummary) => string;

export function buildEmptyGroupsPageResult(
  context: BrowserConsoleContext,
  query: GroupsLoaderQuery,
  searchParams: URLSearchParams,
): BrowserGroupsPageResult {
  return {
    ...buildGroupsPageBaseResult(context, query, searchParams),
    assignments: [],
    groups: [],
    members: [],
    mode: 'list',
    page: 1,
    pageSize: query.pageSize,
    pageSizeOptions: browserTablePageSizeOptions,
    projectCount: 0,
    roles: [],
    scopeProjects: [],
    selectedGroup: null,
    selectedGroupId: null,
    selectedOrganizationSlug: null,
    totalGroups: 0,
    totalPages: 1,
  };
}

export function buildGroupsPageResult(
  context: BrowserConsoleContext,
  query: GroupsLoaderQuery,
  searchParams: URLSearchParams,
  projectCount: number,
  pageResponses: GroupsPageResponses,
  members: AccessGroupMemberSummary[],
  mode: GroupsPageMode,
  selectedGroupId: string | null,
): BrowserGroupsPageResult {
  const pageResult: GroupsPageListResult = readGroupsPageListResult(pageResponses);

  return {
    ...buildGroupsPageBaseResult(context, query, searchParams),
    ...pageResult,
    members,
    mode,
    pageSize: query.pageSize,
    pageSizeOptions: browserTablePageSizeOptions,
    projectCount,
    selectedGroup: readSelectedGroupRow(pageResponses, selectedGroupId),
    selectedGroupId,
    selectedOrganizationSlug: context.selectedOrganizationSlug,
  };
}

export function readLoadedSelectedGroupId(
  requestedGroupId: string | null,
  pageResponses: GroupsPageResponses,
): string | null {
  if (requestedGroupId === null) {
    return null;
  }

  const selectedGroupResponse: AccessGroupResponse | null = pageResponses.selectedGroupResponse;

  return (selectedGroupResponse !== null && selectedGroupResponse.group.id === requestedGroupId) ||
    pageResponses.groupsResponse.groups.some((group: AccessGroupSummary): boolean => group.id === requestedGroupId)
    ? requestedGroupId
    : null;
}

function buildGroupsPageBaseResult(
  context: BrowserConsoleContext,
  query: GroupsLoaderQuery,
  searchParams: URLSearchParams,
): BrowserGroupsPageBaseResult {
  return {
    currentOrganizationPermissions: context.currentOrganizationPermissions,
    errorMessage: readBrowserErrorMessage(searchParams.get('error')),
    noticeMessage: readBrowserNoticeMessage(searchParams.get('notice')),
    organizationContext: context.organizationContext,
    organizations: context.organizations,
    principalEmail: context.principalEmail,
    searchQuery: query.searchQuery,
    showOrganizationSelector: context.showOrganizationSelector,
    sortBy: query.sortBy,
    sortDirection: query.sortDirection,
  };
}

function readGroupsPageListResult(pageResponses: GroupsPageResponses): GroupsPageListResult {
  return {
    assignments: pageResponses.assignmentsResponse.assignments,
    groups: pageResponses.groupsResponse.groups,
    page: pageResponses.groupsResponse.pagination.page,
    roles: pageResponses.rolesResponse.roles,
    scopeProjects: pageResponses.scopeOptionsResponse.projects,
    totalGroups: pageResponses.groupsResponse.pagination.totalItems,
    totalPages: pageResponses.groupsResponse.pagination.totalPages,
  };
}

function readSelectedGroupRow(
  pageResponses: GroupsPageResponses,
  selectedGroupId: string | null,
): AccessGroupListRow | null {
  if (selectedGroupId === null) {
    return null;
  }

  const pageGroup: AccessGroupListRow | undefined = pageResponses.groupsResponse.groups.find(
    (group: AccessGroupSummary): boolean => group.id === selectedGroupId,
  );
  if (pageGroup !== undefined) {
    return pageGroup;
  }

  const group: AccessGroupSummary | undefined = pageResponses.selectedGroupResponse?.group;
  if (group === undefined) {
    return null;
  }

  return {
    ...group,
    assignedRoleNames: readSelectedGroupAssignedRoleNames(pageResponses.assignmentsResponse.assignments, group.id),
    assignmentScopeLabels: readSelectedGroupScopeLabels(pageResponses.assignmentsResponse.assignments, group.id),
  };
}

function readSelectedGroupAssignedRoleNames(
  assignments: readonly AccessAssignmentSummary[],
  groupId: string,
): string[] {
  return readSelectedGroupAssignmentValues(
    assignments,
    groupId,
    (assignment: AccessAssignmentSummary): string => assignment.roleName,
  );
}

function readSelectedGroupScopeLabels(assignments: readonly AccessAssignmentSummary[], groupId: string): string[] {
  return readSelectedGroupAssignmentValues(assignments, groupId, readAccessAssignmentScopeLabel);
}

function readSelectedGroupAssignmentValues(
  assignments: readonly AccessAssignmentSummary[],
  groupId: string,
  readValue: AccessGroupAssignmentValueReader,
): string[] {
  return [
    ...new Set(
      assignments
        .filter(
          (assignment: AccessAssignmentSummary): boolean =>
            assignment.subject.subjectType === 'group' && assignment.subject.groupId === groupId,
        )
        .map(readValue),
    ),
  ].sort((left: string, right: string): number => left.localeCompare(right));
}

function readAccessAssignmentScopeLabel(assignment: AccessAssignmentSummary): string {
  switch (assignment.scope.scopeType) {
    case 'organization':
      return 'Org-wide';
    case 'project':
      return assignment.scope.projectName;
    case 'environment':
      return `${assignment.scope.projectName} / ${assignment.scope.environmentName}`;
  }
}
