import type { CreateOrganizationResponse } from '@compartment/contracts';
import { createOrganization as createOrganizationRequester } from '@compartment/sdk';
import { createAuthenticatedRequester } from './context.service';
import type { AuthenticatedContext } from './context.types';
import type { CreateOrganizationInput } from './create-organization.service.types';

export async function createOrganization(
  context: AuthenticatedContext,
  input: CreateOrganizationInput,
): Promise<CreateOrganizationResponse> {
  return await createOrganizationRequester(
    createAuthenticatedRequester(context, {
      includeCurrentOrganization: false,
    }),
    input,
  );
}
