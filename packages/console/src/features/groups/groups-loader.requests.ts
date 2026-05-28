import {
  accessAssignmentListResponseSchema,
  accessAssignmentScopeOptionsResponseSchema,
  accessGroupListPageResponseSchema,
  accessGroupMemberListResponseSchema,
  accessRoleListOptionsResponseSchema,
  accessRoleListResponseSchema,
  compartmentAssignmentScopeOptionsPathname,
  compartmentAssignmentsPathname,
  compartmentGroupsPathname,
  compartmentGroupMembersPathnameSuffix,
  compartmentRolesPathname,
  type AccessAssignmentListResponse,
  type AccessAssignmentScopeOptionsResponse,
  type AccessGroupListPageResponse,
  type AccessGroupMemberListResponse,
  type AccessGroupMemberSummary,
  type AccessRoleListOptionsResponse,
  type AccessRoleListResponse,
} from '@compartment/contracts/browser';
import { BrowserApiError, requestBrowserApi, type BrowserApiRequestOptions } from '../../lib/browser-api';
import { buildBrowserAccessPageListPath } from '../access/access-list-path';
import type { GroupsLoaderQuery } from './groups-loader';

export async function fetchScopeOptionsResponse(
  currentOrganization: string,
  options: BrowserApiRequestOptions = {},
): Promise<AccessAssignmentScopeOptionsResponse> {
  return await requestBrowserApi(
    compartmentAssignmentScopeOptionsPathname,
    accessAssignmentScopeOptionsResponseSchema,
    {
      currentOrganization,
      signal: options.signal,
    },
  );
}

export async function fetchGroupsResponse(
  currentOrganization: string,
  query: GroupsLoaderQuery,
  options: BrowserApiRequestOptions = {},
): Promise<AccessGroupListPageResponse> {
  return await requestBrowserApi(
    buildBrowserAccessPageListPath(compartmentGroupsPathname, query),
    accessGroupListPageResponseSchema,
    {
      currentOrganization,
      signal: options.signal,
    },
  );
}

export async function fetchRolesResponse(
  currentOrganization: string,
  options: BrowserApiRequestOptions = {},
): Promise<AccessRoleListResponse> {
  const response: AccessRoleListOptionsResponse = await requestBrowserApi(
    `${compartmentRolesPathname}?detail=options`,
    accessRoleListOptionsResponseSchema,
    {
      currentOrganization,
      signal: options.signal,
    },
  );

  return accessRoleListResponseSchema.parse({ roles: response.roles });
}

export async function fetchAssignmentsResponse(
  currentOrganization: string,
  options: BrowserApiRequestOptions = {},
): Promise<AccessAssignmentListResponse> {
  return await requestBrowserApi(compartmentAssignmentsPathname, accessAssignmentListResponseSchema, {
    currentOrganization,
    signal: options.signal,
  });
}

export async function loadSelectedGroupMembers(
  organizationSlug: string,
  groupId: string | null,
  options: BrowserApiRequestOptions = {},
): Promise<AccessGroupMemberSummary[]> {
  if (groupId === null) {
    return [];
  }

  try {
    const response: AccessGroupMemberListResponse = await requestBrowserApi(
      `${compartmentGroupsPathname}/${encodeURIComponent(groupId)}${compartmentGroupMembersPathnameSuffix}`,
      accessGroupMemberListResponseSchema,
      {
        currentOrganization: organizationSlug,
        signal: options.signal,
      },
    );

    return response.members;
  } catch (error) {
    if (error instanceof BrowserApiError && error.status === 404) {
      return [];
    }

    throw error;
  }
}
