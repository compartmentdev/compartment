import {
  buildCompartmentUserApiPathname,
  removeUserResponseSchema,
  type RemoveUserResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function removeUser(request: CompartmentRequester, email: string): Promise<RemoveUserResponse> {
  return await request<RemoveUserResponse, undefined>({
    method: 'DELETE',
    path: buildCompartmentUserApiPathname(email),
    schema: removeUserResponseSchema,
  });
}
