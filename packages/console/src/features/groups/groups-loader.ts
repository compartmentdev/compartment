import {
  type AccessAssignmentListResponse,
  type AccessAssignmentScopeOptionsResponse,
  type AccessGroupSummary,
  type AccessGroupListResponse,
  type AccessGroupMemberSummary,
  type AccessRoleListResponse,
  type PermissionKey,
} from '@compartment/contracts/browser';
import { redirect, type LoaderFunctionArgs } from 'react-router';
import type { BrowserGroupsPageResult } from '../../services/browser-groups.service.types';
import type { BrowserApiRequestOptions } from '../../lib/browser-api';
import { BrowserRedirect, readBrowserApiRedirect } from '../../lib/browser-redirect';
import {
  loadBrowserConsoleContext,
  readBrowserErrorMessage,
  readBrowserNoticeMessage,
  type BrowserConsoleContext,
} from '../console/console-data';
import {
  buildUsersAdminRequiredRedirectTarget,
  canManageBrowserGroups,
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

interface GroupsPageResponses {
  assignmentsResponse: AccessAssignmentListResponse;
  groupsResponse: AccessGroupListResponse;
  rolesResponse: AccessRoleListResponse;
  scopeOptionsResponse: AccessAssignmentScopeOptionsResponse;
}

const emptyAssignmentsResponse: AccessAssignmentListResponse = { assignments: [] };
const emptyRolesResponse: AccessRoleListResponse = { roles: [] };
const emptyScopeOptionsResponse: AccessAssignmentScopeOptionsResponse = { projects: [] };

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
  const context: BrowserConsoleContext = await loadBrowserConsoleContext(url, options);
  if (context.selectedOrganizationSlug === null) {
    return buildEmptyGroupsPageResult(context, url.searchParams);
  }
  const usersAdminRequiredRedirectTarget: string = buildUsersAdminRequiredRedirectTarget(
    context.selectedOrganizationSlug,
  );
  if (!canReadBrowserGroups(context.currentOrganizationPermissions)) {
    throw new BrowserRedirect(usersAdminRequiredRedirectTarget);
  }

  try {
    return await loadSelectedOrganizationGroupsPageData(context, url.searchParams, options);
  } catch (error) {
    if (error instanceof Error) {
      throw readBrowserApiRedirect(error, usersAdminRequiredRedirectTarget) ?? error;
    }

    throw error;
  }
}

function buildEmptyGroupsPageResult(
  context: BrowserConsoleContext,
  searchParams: URLSearchParams,
): BrowserGroupsPageResult {
  return {
    assignments: [],
    currentOrganizationPermissions: context.currentOrganizationPermissions,
    errorMessage: readBrowserErrorMessage(searchParams.get('error')),
    groups: [],
    mode: 'list',
    members: [],
    noticeMessage: readBrowserNoticeMessage(searchParams.get('notice')),
    organizationContext: context.organizationContext,
    organizations: context.organizations,
    principalEmail: context.principalEmail,
    roles: [],
    scopeProjects: [],
    selectedGroupId: null,
    selectedOrganizationSlug: null,
    showOrganizationSelector: context.showOrganizationSelector,
  };
}

async function loadSelectedOrganizationGroupsPageData(
  context: BrowserConsoleContext,
  searchParams: URLSearchParams,
  options: BrowserApiRequestOptions,
): Promise<BrowserGroupsPageResult> {
  const currentOrganization: string = requireBrowserAccessSelectedOrganizationSlug(context.selectedOrganizationSlug);
  const permissions: PermissionKey[] = context.currentOrganizationPermissions;
  const pageResponses: GroupsPageResponses = await loadGroupsPageResponses(currentOrganization, permissions, options);
  const selectedGroupId: string | null = readSelectedGroupId(searchParams, pageResponses.groupsResponse);
  const members: AccessGroupMemberSummary[] = await loadSelectedGroupMembers(
    currentOrganization,
    selectedGroupId,
    options,
  );
  const mode: 'create' | 'detail' | 'list' = readGroupsMode(searchParams, selectedGroupId, permissions);

  return buildGroupsPageResult(context, searchParams, pageResponses, members, mode, selectedGroupId);
}

async function loadGroupsPageResponses(
  currentOrganization: string,
  permissions: PermissionKey[],
  options: BrowserApiRequestOptions,
): Promise<GroupsPageResponses> {
  const [scopeOptionsResponse, groupsResponse, rolesResponse, assignmentsResponse]: [
    AccessAssignmentScopeOptionsResponse,
    AccessGroupListResponse,
    AccessRoleListResponse,
    AccessAssignmentListResponse,
  ] = await Promise.all([
    canReadBrowserRoles(permissions)
      ? fetchScopeOptionsResponse(currentOrganization, options)
      : Promise.resolve(emptyScopeOptionsResponse),
    fetchGroupsResponse(currentOrganization, options),
    canReadBrowserRoles(permissions)
      ? fetchRolesResponse(currentOrganization, options)
      : Promise.resolve(emptyRolesResponse),
    canReadBrowserRoles(permissions)
      ? fetchAssignmentsResponse(currentOrganization, options)
      : Promise.resolve(emptyAssignmentsResponse),
  ]);

  return { assignmentsResponse, groupsResponse, rolesResponse, scopeOptionsResponse };
}

function buildGroupsPageResult(
  context: BrowserConsoleContext,
  searchParams: URLSearchParams,
  pageResponses: GroupsPageResponses,
  members: AccessGroupMemberSummary[],
  mode: 'create' | 'detail' | 'list',
  selectedGroupId: string | null,
): BrowserGroupsPageResult {
  return {
    ...readGroupsPageBaseResult(context, searchParams),
    assignments: pageResponses.assignmentsResponse.assignments,
    groups: pageResponses.groupsResponse.groups,
    mode,
    members,
    roles: pageResponses.rolesResponse.roles,
    scopeProjects: pageResponses.scopeOptionsResponse.projects,
    selectedGroupId,
    selectedOrganizationSlug: context.selectedOrganizationSlug,
    showOrganizationSelector: context.showOrganizationSelector,
  };
}

function readGroupsPageBaseResult(
  context: BrowserConsoleContext,
  searchParams: URLSearchParams,
): Pick<
  BrowserGroupsPageResult,
  | 'currentOrganizationPermissions'
  | 'errorMessage'
  | 'noticeMessage'
  | 'organizationContext'
  | 'organizations'
  | 'principalEmail'
> {
  return {
    currentOrganizationPermissions: context.currentOrganizationPermissions,
    errorMessage: readBrowserErrorMessage(searchParams.get('error')),
    noticeMessage: readBrowserNoticeMessage(searchParams.get('notice')),
    organizationContext: context.organizationContext,
    organizations: context.organizations,
    principalEmail: context.principalEmail,
  };
}

function readSelectedGroupId(searchParams: URLSearchParams, response: AccessGroupListResponse): string | null {
  const groupId: string | null = searchParams.get('groupId');
  if (groupId !== null && response.groups.some((group: AccessGroupSummary): boolean => group.id === groupId)) {
    return groupId;
  }

  return null;
}

function readGroupsMode(
  searchParams: URLSearchParams,
  selectedGroupId: string | null,
  permissions: PermissionKey[],
): 'create' | 'detail' | 'list' {
  if (searchParams.get('mode') === 'create' && canManageBrowserGroups(permissions)) {
    return 'create';
  }
  if (selectedGroupId !== null) {
    return 'detail';
  }

  return 'list';
}
