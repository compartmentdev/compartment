import type { LogoutResponse } from '@compartment/contracts';

import type { AuthenticatedContext } from './context.types';
import { createAuthenticatedRequester } from './context.service';
import { logoutCompartment } from '@compartment/sdk';

export async function logout(context: AuthenticatedContext): Promise<LogoutResponse> {
  await logoutCompartment(
    createAuthenticatedRequester(context, {
      includeCurrentOrganization: false,
    }),
  );
  return {
    success: true,
  };
}
