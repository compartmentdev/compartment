import {
  accessAssignmentListResponseSchema,
  accessAssignmentScopeOptionsResponseSchema,
  accessGroupListResponseSchema,
  accessGroupMemberListResponseSchema,
  accessRoleListResponseSchema,
  compartmentAssignmentScopeOptionsPathname,
  compartmentAssignmentsPathname,
  compartmentGroupsPathname,
  compartmentGroupMembersPathnameSuffix,
  compartmentRolesPathname,
  type AccessAssignmentListResponse,
  type AccessAssignmentScopeOptionsResponse,
  type AccessGroupMemberListResponse,
  type AccessGroupListResponse,
  type AccessGroupMemberSummary,
  type AccessRoleListResponse,
} from '@compartment/contracts/browser';
import { requestBrowserApi, type BrowserApiRequestOptions } from '../../lib/browser-api';

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
  options: BrowserApiRequestOptions = {},
): Promise<AccessGroupListResponse> {
  return await requestBrowserApi(compartmentGroupsPathname, accessGroupListResponseSchema, {
    currentOrganization,
    signal: options.signal,
  });
}

export async function fetchRolesResponse(
  currentOrganization: string,
  options: BrowserApiRequestOptions = {},
): Promise<AccessRoleListResponse> {
  return await requestBrowserApi(compartmentRolesPathname, accessRoleListResponseSchema, {
    currentOrganization,
    signal: options.signal,
  });
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

  const response: AccessGroupMemberListResponse = await requestBrowserApi(
    `${compartmentGroupsPathname}/${encodeURIComponent(groupId)}${compartmentGroupMembersPathnameSuffix}`,
    accessGroupMemberListResponseSchema,
    {
      currentOrganization: organizationSlug,
      signal: options.signal,
    },
  );

  return response.members;
}
