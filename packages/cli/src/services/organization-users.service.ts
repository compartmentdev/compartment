import type {
  InviteUserRequest,
  InviteUserResponse,
  OrganizationUserResponse,
  RemoveUserResponse,
  UserListResponse,
} from '@compartment/contracts';
import { blockUser, inviteUser, listUsers, removeUser, unblockUser, type CompartmentRequester } from '@compartment/sdk';
import { createAuthenticatedRequester, requireOrganizationContext } from './context.service';
import type { AuthenticatedContext } from './context.types';
import type { OrganizationUserListInput } from './organization-users.service.types';

export async function listOrganizationUsers(
  context: AuthenticatedContext,
  input: OrganizationUserListInput,
): Promise<UserListResponse> {
  return await listUsers(createOrganizationUserRequester(context), {
    page: input.page,
    perPage: input.perPage,
  });
}

export async function inviteOrganizationUser(
  context: AuthenticatedContext,
  input: InviteUserRequest,
): Promise<InviteUserResponse> {
  return await inviteUser(createOrganizationUserRequester(context), input);
}

export async function removeOrganizationUser(
  context: AuthenticatedContext,
  email: string,
): Promise<RemoveUserResponse> {
  return await removeUser(createOrganizationUserRequester(context), email);
}

export async function blockOrganizationUser(
  context: AuthenticatedContext,
  email: string,
): Promise<OrganizationUserResponse> {
  return await blockUser(createOrganizationUserRequester(context), email);
}

export async function unblockOrganizationUser(
  context: AuthenticatedContext,
  email: string,
): Promise<OrganizationUserResponse> {
  return await unblockUser(createOrganizationUserRequester(context), email);
}

function createOrganizationUserRequester(context: AuthenticatedContext): CompartmentRequester {
  return createAuthenticatedRequester(requireOrganizationContext(context), {
    includeCurrentOrganization: true,
  });
}
