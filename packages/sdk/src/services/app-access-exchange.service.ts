import {
  appAccessExchangeResponseSchema,
  compartmentInternalAppAccessExchangePathname,
  type AppAccessExchangeRequest,
  type AppAccessExchangeResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function exchangeAppAccess(
  request: CompartmentRequester,
  body: AppAccessExchangeRequest,
): Promise<AppAccessExchangeResponse> {
  return await request<AppAccessExchangeResponse, AppAccessExchangeRequest>({
    body,
    method: 'POST',
    path: compartmentInternalAppAccessExchangePathname,
    schema: appAccessExchangeResponseSchema,
  });
}
