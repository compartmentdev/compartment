import {
  accessGroupListOptionsResponseSchema,
  accessGroupListResponseSchema,
  accessGroupMemberListResponseSchema,
  accessGroupResponseSchema,
  addAccessGroupMemberRequestSchema,
  compartmentGroupMembersPathnameSuffix,
  compartmentGroupsPathname,
  createAccessGroupRequestSchema,
  type AccessGroupListOptionsResponse,
  type AccessGroupListResponse,
  type AccessGroupMemberListResponse,
  type AccessGroupResponse,
  type AddAccessGroupMemberRequest,
  type CreateAccessGroupRequest,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';
import { buildAccessListOptionsPath } from './access-list-path.service';

export async function listAccessGroups(request: CompartmentRequester): Promise<AccessGroupListResponse> {
  const response: AccessGroupListOptionsResponse = await listAccessGroupOptions(request);
  return accessGroupListResponseSchema.parse({ groups: response.groups });
}

async function listAccessGroupOptions(request: CompartmentRequester): Promise<AccessGroupListOptionsResponse> {
  return await request({
    method: 'GET',
    path: buildAccessListOptionsPath(compartmentGroupsPathname),
    schema: accessGroupListOptionsResponseSchema,
  });
}

export async function createAccessGroup(
  request: CompartmentRequester,
  body: CreateAccessGroupRequest,
): Promise<AccessGroupResponse> {
  return await request({
    body: createAccessGroupRequestSchema.parse(body),
    method: 'POST',
    path: compartmentGroupsPathname,
    schema: accessGroupResponseSchema,
  });
}

export async function deleteAccessGroup(request: CompartmentRequester, groupId: string): Promise<AccessGroupResponse> {
  return await request({
    method: 'DELETE',
    path: `${compartmentGroupsPathname}/${encodeURIComponent(groupId)}`,
    schema: accessGroupResponseSchema,
  });
}

export async function listAccessGroupMembers(
  request: CompartmentRequester,
  groupId: string,
): Promise<AccessGroupMemberListResponse> {
  return await request({
    method: 'GET',
    path: `${compartmentGroupsPathname}/${encodeURIComponent(groupId)}${compartmentGroupMembersPathnameSuffix}`,
    schema: accessGroupMemberListResponseSchema,
  });
}

export async function addAccessGroupMember(
  request: CompartmentRequester,
  groupId: string,
  body: AddAccessGroupMemberRequest,
): Promise<AccessGroupMemberListResponse> {
  return await request({
    body: addAccessGroupMemberRequestSchema.parse(body),
    method: 'POST',
    path: `${compartmentGroupsPathname}/${encodeURIComponent(groupId)}${compartmentGroupMembersPathnameSuffix}`,
    schema: accessGroupMemberListResponseSchema,
  });
}

export async function removeAccessGroupMember(
  request: CompartmentRequester,
  groupId: string,
  email: string,
): Promise<AccessGroupMemberListResponse> {
  return await request({
    method: 'DELETE',
    path: `${compartmentGroupsPathname}/${encodeURIComponent(groupId)}${compartmentGroupMembersPathnameSuffix}/${encodeURIComponent(email)}`,
    schema: accessGroupMemberListResponseSchema,
  });
}
