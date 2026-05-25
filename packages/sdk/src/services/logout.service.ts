import { compartmentAuthLogoutPathname, logoutResponseSchema, type LogoutResponse } from '@compartment/contracts';

import type { CompartmentRequester } from '../http/request.types';

export async function logoutCompartment(request: CompartmentRequester): Promise<LogoutResponse> {
  return await request<LogoutResponse, undefined>({
    method: 'POST',
    path: compartmentAuthLogoutPathname,
    schema: logoutResponseSchema,
  });
}
