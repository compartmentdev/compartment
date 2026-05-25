import {
  compartmentUsersApiPathname,
  inviteUserRequestSchema,
  inviteUserResponseSchema,
  type InviteUserRequest,
  type InviteUserResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function inviteUser(request: CompartmentRequester, body: InviteUserRequest): Promise<InviteUserResponse> {
  return await request<InviteUserResponse, InviteUserRequest>({
    body: inviteUserRequestSchema.parse(body),
    method: 'POST',
    path: compartmentUsersApiPathname,
    schema: inviteUserResponseSchema,
  });
}
