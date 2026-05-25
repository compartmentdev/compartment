import {
  appAccessLogoutRequestSchema,
  compartmentInternalAppAccessLogoutPathname,
  logoutResponseSchema,
  type AppAccessLogoutRequest,
  type LogoutResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function logoutAppAccess(
  request: CompartmentRequester,
  body: AppAccessLogoutRequest,
): Promise<LogoutResponse> {
  return await request<LogoutResponse, AppAccessLogoutRequest>({
    body: appAccessLogoutRequestSchema.parse(body),
    method: 'POST',
    path: compartmentInternalAppAccessLogoutPathname,
    schema: logoutResponseSchema,
  });
}
