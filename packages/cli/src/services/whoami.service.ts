import type { WhoAmIResponse } from '@compartment/contracts';

import type { AuthenticatedContext } from './context.types';
import { createAuthenticatedRequester } from './context.service';
import { getWhoAmI } from '@compartment/sdk';

export async function runWhoAmI(context: AuthenticatedContext): Promise<WhoAmIResponse> {
  return await getWhoAmI(
    createAuthenticatedRequester(context, {
      includeCurrentOrganization: true,
    }),
  );
}
