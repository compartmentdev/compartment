import type { ClaimAccountRequest, ClaimAccountResponse } from '@compartment/contracts';
import { claimCompartmentAccount } from '@compartment/sdk';
import { createAuthenticatedRequester } from './context.service';
import type { AuthenticatedContext } from './context.types';

export async function claimAccount(
  context: AuthenticatedContext,
  input: ClaimAccountRequest,
): Promise<ClaimAccountResponse> {
  return await claimCompartmentAccount(
    createAuthenticatedRequester(context, { includeCurrentOrganization: false }),
    input,
  );
}
