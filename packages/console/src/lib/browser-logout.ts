import { logoutResponseSchema } from '@compartment/contracts/browser';
import { authApiLogoutPathname } from '../features/auth/auth-api-paths';
import { requestBrowserApi } from './browser-api';

export async function logoutBrowserSession(): Promise<void> {
  await requestBrowserApi(authApiLogoutPathname, logoutResponseSchema, {
    method: 'POST',
  });
}
