import {
  appAccessSessionResolveResponseSchema,
  compartmentInternalAppAccessSessionResolvePathname,
  type AppAccessSessionResolveRequest,
  type AppAccessSessionResolveResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function resolveAppAccessSession(
  request: CompartmentRequester,
  body: AppAccessSessionResolveRequest,
): Promise<AppAccessSessionResolveResponse> {
  return await request<AppAccessSessionResolveResponse, AppAccessSessionResolveRequest>({
    body,
    method: 'POST',
    path: compartmentInternalAppAccessSessionResolvePathname,
    schema: appAccessSessionResolveResponseSchema,
  });
}
