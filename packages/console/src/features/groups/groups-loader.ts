import {
  type AccessAssignmentListResponse,
  type AccessAssignmentScopeOptionsResponse,
  type AccessGroupListPageResponse,
  type AccessGroupMemberSummary,
  accessGroupResponseSchema,
  compartmentGroupsPathname,
  type AccessGroupResponse,
  type AccessRoleListResponse,
  type PermissionKey,
} from '@compartment/contracts/browser';
import { redirect, type LoaderFunctionArgs } from 'react-router';
import { BrowserApiError, requestBrowserApi, type BrowserApiRequestOptions } from '../../lib/browser-api';
import type { BrowserGroupsPageResult } from '../../services/browser-groups.service.types';
import { BrowserRedirect, readBrowserApiRedirect } from '../../lib/browser-redirect';
import {
  loadBrowserConsoleContext,
  loadSidebarProjectCount,
  type BrowserConsoleContext,
} from '../console/console-data';
import {
  buildUsersAdminRequiredRedirectTarget,
  canReadBrowserGroups,
  canReadBrowserRoles,
} from '../console/console-access';
import { requireBrowserAccessSelectedOrganizationSlug } from '../access/access-query';
import {
  fetchAssignmentsResponse,
  fetchGroupsResponse,
  fetchRolesResponse,
  fetchScopeOptionsResponse,
  loadSelectedGroupMembers,
} from './groups-loader.requests';
import {
  buildEmptyGroupsPageResult,
  buildGroupsPageResult,
  readLoadedSelectedGroupId,
  type GroupsPageResponses,
} from './groups-loader.result';
import {
  readGroupsLoaderQuery,
  readGroupsMode,
  readSelectedGroupId,
  type GroupsLoaderQuery,
} from './groups-loader.query';

export type { GroupsLoaderQuery } from './groups-loader.query';

const emptyAssignmentsResponse: AccessAssignmentListResponse = { assignments: [] };
const emptyRolesResponse: AccessRoleListResponse = { roles: [] };
const emptyScopeOptionsResponse: AccessAssignmentScopeOptionsResponse = { projects: [] };
type GroupsPageResponsesTuple = [
  AccessAssignmentScopeOptionsResponse,
  AccessGroupListPageResponse,
  AccessRoleListResponse,
  AccessAssignmentListResponse,
  AccessGroupResponse | null,
];
interface SelectedOrganizationGroupsPagePayload {
  pageResponses: GroupsPageResponses;
  projectCount: number;
}
interface SelectedOrganizationGroupsPageDataInput {
  context: BrowserConsoleContext;
  currentOrganization: string;
  options: BrowserApiRequestOptions;
  permissions: PermissionKey[];
  query: GroupsLoaderQuery;
  requestedGroupId: string | null;
  searchParams: URLSearchParams;
}
interface SelectedOrganizationGroupsPageState {
  members: AccessGroupMemberSummary[];
  mode: 'create' | 'detail' | 'list';
  selectedGroupId: string | null;
}

export async function loadGroupsPageData({ request }: LoaderFunctionArgs): Promise<BrowserGroupsPageResult> {
  const url: URL = new URL(request.url);

  try {
    return await loadGroupsPageDataForUrl(url, { signal: request.signal });
  } catch (error) {
    if (error instanceof BrowserRedirect) {
      return redirect(error.to) as never;
    }

    throw error;
  }
}

async function loadGroupsPageDataForUrl(
  url: URL,
  options: BrowserApiRequestOptions = {},
): Promise<BrowserGroupsPageResult> {
  const query: GroupsLoaderQuery = readGroupsLoaderQuery(url.searchParams);
  const context: BrowserConsoleContext = await loadBrowserConsoleContext(url, options);
  if (context.selectedOrganizationSlug === null) {
    return buildEmptyGroupsPageResult(context, query, url.searchParams);
  }
  const usersAdminRequiredRedirectTarget: string = buildUsersAdminRequiredRedirectTarget(
    context.selectedOrganizationSlug,
  );
  if (!canReadBrowserGroups(context.currentOrganizationPermissions)) {
    throw new BrowserRedirect(usersAdminRequiredRedirectTarget);
  }

  try {
    return await loadSelectedOrganizationGroupsPageData(context, query, url.searchParams, options);
  } catch (error) {
    if (error instanceof Error) {
      throw readBrowserApiRedirect(error, usersAdminRequiredRedirectTarget) ?? error;
    }

    throw error;
  }
}

async function loadSelectedOrganizationGroupsPageData(
  context: BrowserConsoleContext,
  query: GroupsLoaderQuery,
  searchParams: URLSearchParams,
  options: BrowserApiRequestOptions,
): Promise<BrowserGroupsPageResult> {
  return await loadSelectedOrganizationGroupsResolvedPageData({
    context,
    currentOrganization: requireBrowserAccessSelectedOrganizationSlug(context.selectedOrganizationSlug),
    options,
    permissions: context.currentOrganizationPermissions,
    query,
    requestedGroupId: readSelectedGroupId(searchParams),
    searchParams,
  });
}

async function loadSelectedOrganizationGroupsResolvedPageData(
  input: SelectedOrganizationGroupsPageDataInput,
): Promise<BrowserGroupsPageResult> {
  const payload: SelectedOrganizationGroupsPagePayload = await loadSelectedOrganizationGroupsPagePayload(
    input.currentOrganization,
    input.permissions,
    input.query,
    input.requestedGroupId,
    input.options,
  );
  const pageState: SelectedOrganizationGroupsPageState = await loadSelectedOrganizationGroupsPageState(
    input.currentOrganization,
    input.permissions,
    input.searchParams,
    input.requestedGroupId,
    payload.pageResponses,
    input.options,
  );

  return buildSelectedOrganizationGroupsPageResult(input, payload, pageState);
}

async function loadSelectedOrganizationGroupsPagePayload(
  currentOrganization: string,
  permissions: PermissionKey[],
  query: GroupsLoaderQuery,
  requestedGroupId: string | null,
  options: BrowserApiRequestOptions,
): Promise<SelectedOrganizationGroupsPagePayload> {
  const [projectCount, pageResponses]: [number, GroupsPageResponses] = await Promise.all([
    loadSidebarProjectCount(currentOrganization, options),
    loadGroupsPageResponses(currentOrganization, permissions, query, requestedGroupId, options),
  ]);

  return { pageResponses, projectCount };
}

async function loadGroupsPageResponses(
  currentOrganization: string,
  permissions: PermissionKey[],
  query: GroupsLoaderQuery,
  selectedGroupId: string | null,
  options: BrowserApiRequestOptions,
): Promise<GroupsPageResponses> {
  const canReadRoles: boolean = canReadBrowserRoles(permissions);
  const [
    scopeOptionsResponse,
    groupsResponse,
    rolesResponse,
    assignmentsResponse,
    selectedGroupResponse,
  ]: GroupsPageResponsesTuple = await Promise.all([
    canReadRoles ? fetchScopeOptionsResponse(currentOrganization, options) : Promise.resolve(emptyScopeOptionsResponse),
    fetchGroupsResponse(currentOrganization, query, options),
    canReadRoles ? fetchRolesResponse(currentOrganization, options) : Promise.resolve(emptyRolesResponse),
    canReadRoles ? fetchAssignmentsResponse(currentOrganization, options) : Promise.resolve(emptyAssignmentsResponse),
    readSelectedGroup(currentOrganization, selectedGroupId, options),
  ]);

  return { assignmentsResponse, groupsResponse, rolesResponse, selectedGroupResponse, scopeOptionsResponse };
}

async function loadSelectedOrganizationGroupsPageState(
  currentOrganization: string,
  permissions: PermissionKey[],
  searchParams: URLSearchParams,
  requestedGroupId: string | null,
  pageResponses: GroupsPageResponses,
  options: BrowserApiRequestOptions,
): Promise<SelectedOrganizationGroupsPageState> {
  const selectedGroupId: string | null = readLoadedSelectedGroupId(requestedGroupId, pageResponses);
  const members: AccessGroupMemberSummary[] = await loadSelectedGroupMembers(
    currentOrganization,
    selectedGroupId,
    options,
  );

  return {
    members,
    mode: readGroupsMode(searchParams, selectedGroupId, permissions),
    selectedGroupId,
  };
}

function buildSelectedOrganizationGroupsPageResult(
  input: SelectedOrganizationGroupsPageDataInput,
  payload: SelectedOrganizationGroupsPagePayload,
  pageState: SelectedOrganizationGroupsPageState,
): BrowserGroupsPageResult {
  return buildGroupsPageResult(
    input.context,
    input.query,
    input.searchParams,
    payload.projectCount,
    payload.pageResponses,
    pageState.members,
    pageState.mode,
    pageState.selectedGroupId,
  );
}

async function readSelectedGroup(
  currentOrganization: string,
  groupId: string | null,
  options: BrowserApiRequestOptions,
): Promise<AccessGroupResponse | null> {
  if (groupId === null) {
    return null;
  }

  try {
    return await requestBrowserApi(
      `${compartmentGroupsPathname}/${encodeURIComponent(groupId)}`,
      accessGroupResponseSchema,
      {
        currentOrganization,
        signal: options.signal,
      },
    );
  } catch (error) {
    if (error instanceof BrowserApiError && error.status === 404) {
      return null;
    }

    throw error;
  }
}
