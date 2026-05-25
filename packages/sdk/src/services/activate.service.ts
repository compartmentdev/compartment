import {
  activateResponseSchema,
  compartmentAuthActivatePathname,
  type ActivateRequest,
  type ActivateResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function activateCompartment(
  request: CompartmentRequester,
  body: ActivateRequest,
): Promise<ActivateResponse> {
  return await request<ActivateResponse, ActivateRequest>({
    body,
    method: 'POST',
    path: compartmentAuthActivatePathname,
    schema: activateResponseSchema,
  });
}
