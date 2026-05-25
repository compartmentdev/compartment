import type {
  AccessAssignmentListResponse,
  AccessAssignmentResponse,
  AccessGroupListResponse,
  AccessGroupMemberListResponse,
  AccessGroupResponse,
  AccessRoleListResponse,
  AccessRoleResponse,
  AddAccessGroupMemberRequest,
  CreateAccessAssignmentRequest,
  CreateAccessGroupRequest,
  CreateAccessRoleRequest,
  UpdateAccessRoleRequest,
} from '@compartment/contracts';
import {
  addAccessGroupMember,
  createAccessAssignment,
  createAccessGroup,
  createAccessRole,
  deleteAccessAssignment,
  deleteAccessGroup,
  deleteAccessRole,
  getAccessRole,
  listAccessAssignments,
  listAccessGroupMembers,
  listAccessGroups,
  listAccessRoles,
  removeAccessGroupMember,
  updateAccessRole,
  type CompartmentRequester,
} from '@compartment/sdk';
import { createAuthenticatedRequester, requireOrganizationContext } from './context.service';
import type { AuthenticatedContext } from './context.types';

export async function listOrganizationAccessRoles(context: AuthenticatedContext): Promise<AccessRoleListResponse> {
  return await listAccessRoles(createOrganizationRequester(context));
}

export async function showOrganizationAccessRole(
  context: AuthenticatedContext,
  roleId: string,
): Promise<AccessRoleResponse> {
  return await getAccessRole(createOrganizationRequester(context), roleId);
}

export async function createOrganizationAccessRole(
  context: AuthenticatedContext,
  input: CreateAccessRoleRequest,
): Promise<AccessRoleResponse> {
  return await createAccessRole(createOrganizationRequester(context), input);
}

export async function updateOrganizationAccessRole(
  context: AuthenticatedContext,
  roleId: string,
  input: UpdateAccessRoleRequest,
): Promise<AccessRoleResponse> {
  return await updateAccessRole(createOrganizationRequester(context), roleId, input);
}

export async function deleteOrganizationAccessRole(
  context: AuthenticatedContext,
  roleId: string,
): Promise<AccessRoleResponse> {
  return await deleteAccessRole(createOrganizationRequester(context), roleId);
}

export async function listOrganizationAccessGroups(context: AuthenticatedContext): Promise<AccessGroupListResponse> {
  return await listAccessGroups(createOrganizationRequester(context));
}

export async function createOrganizationAccessGroup(
  context: AuthenticatedContext,
  input: CreateAccessGroupRequest,
): Promise<AccessGroupResponse> {
  return await createAccessGroup(createOrganizationRequester(context), input);
}

export async function deleteOrganizationAccessGroup(
  context: AuthenticatedContext,
  groupId: string,
): Promise<AccessGroupResponse> {
  return await deleteAccessGroup(createOrganizationRequester(context), groupId);
}

export async function listOrganizationAccessGroupMembers(
  context: AuthenticatedContext,
  groupId: string,
): Promise<AccessGroupMemberListResponse> {
  return await listAccessGroupMembers(createOrganizationRequester(context), groupId);
}

export async function addOrganizationAccessGroupMember(
  context: AuthenticatedContext,
  groupId: string,
  input: AddAccessGroupMemberRequest,
): Promise<AccessGroupMemberListResponse> {
  return await addAccessGroupMember(createOrganizationRequester(context), groupId, input);
}

export async function removeOrganizationAccessGroupMember(
  context: AuthenticatedContext,
  groupId: string,
  email: string,
): Promise<AccessGroupMemberListResponse> {
  return await removeAccessGroupMember(createOrganizationRequester(context), groupId, email);
}

export async function listOrganizationAccessAssignments(
  context: AuthenticatedContext,
): Promise<AccessAssignmentListResponse> {
  return await listAccessAssignments(createOrganizationRequester(context));
}

export async function createOrganizationAccessAssignment(
  context: AuthenticatedContext,
  input: CreateAccessAssignmentRequest,
): Promise<AccessAssignmentResponse> {
  return await createAccessAssignment(createOrganizationRequester(context), input);
}

export async function deleteOrganizationAccessAssignment(
  context: AuthenticatedContext,
  assignmentId: string,
): Promise<AccessAssignmentResponse> {
  return await deleteAccessAssignment(createOrganizationRequester(context), assignmentId);
}

function createOrganizationRequester(context: AuthenticatedContext): CompartmentRequester {
  return createAuthenticatedRequester(requireOrganizationContext(context), {
    includeCurrentOrganization: true,
  });
}
