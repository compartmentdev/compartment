import {
  appAccessStateResponseSchema,
  compartmentInternalAppAccessStatePathname,
  type AppAccessStateResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function getAppAccessState(request: CompartmentRequester): Promise<AppAccessStateResponse> {
  return await request<AppAccessStateResponse, undefined>({
    method: 'GET',
    path: compartmentInternalAppAccessStatePathname,
    schema: appAccessStateResponseSchema,
  });
}
