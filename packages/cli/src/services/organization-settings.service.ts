import type { OrganizationSettingsResponse, UpdateOrganizationSettingsRequest } from '@compartment/contracts';
import { getOrganizationSettings, updateOrganizationSettings, type CompartmentRequester } from '@compartment/sdk';
import { createAuthenticatedRequester, requireOrganizationContext } from './context.service';
import type { AuthenticatedContext } from './context.types';

export async function readOrganizationSettings(context: AuthenticatedContext): Promise<OrganizationSettingsResponse> {
  return await getOrganizationSettings(createOrganizationSettingsRequester(context));
}

export async function updateCurrentOrganizationSettings(
  context: AuthenticatedContext,
  input: UpdateOrganizationSettingsRequest,
): Promise<OrganizationSettingsResponse> {
  return await updateOrganizationSettings(createOrganizationSettingsRequester(context), input);
}

function createOrganizationSettingsRequester(context: AuthenticatedContext): CompartmentRequester {
  return createAuthenticatedRequester(requireOrganizationContext(context), {
    includeCurrentOrganization: true,
  });
}
