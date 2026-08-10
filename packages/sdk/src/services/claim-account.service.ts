import {
  claimAccountResponseSchema,
  compartmentAuthClaimPathname,
  type ClaimAccountRequest,
  type ClaimAccountResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function claimCompartmentAccount(
  request: CompartmentRequester,
  body: ClaimAccountRequest,
): Promise<ClaimAccountResponse> {
  return await request<ClaimAccountResponse, ClaimAccountRequest>({
    body,
    method: 'POST',
    path: compartmentAuthClaimPathname,
    schema: claimAccountResponseSchema,
  });
}
