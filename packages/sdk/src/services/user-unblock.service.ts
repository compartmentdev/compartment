import {
  buildCompartmentUserUnblockApiPathname,
  organizationUserResponseSchema,
  type OrganizationUserResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function unblockUser(request: CompartmentRequester, email: string): Promise<OrganizationUserResponse> {
  return await request<OrganizationUserResponse, undefined>({
    method: 'POST',
    path: buildCompartmentUserUnblockApiPathname(email),
    schema: organizationUserResponseSchema,
  });
}
