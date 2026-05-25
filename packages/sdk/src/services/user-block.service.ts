import {
  buildCompartmentUserBlockApiPathname,
  organizationUserResponseSchema,
  type OrganizationUserResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function blockUser(request: CompartmentRequester, email: string): Promise<OrganizationUserResponse> {
  return await request<OrganizationUserResponse, undefined>({
    method: 'POST',
    path: buildCompartmentUserBlockApiPathname(email),
    schema: organizationUserResponseSchema,
  });
}
