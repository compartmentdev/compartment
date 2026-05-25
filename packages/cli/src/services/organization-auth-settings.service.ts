import type { OrganizationAuthSettingsResponse, UpdateOrganizationAuthSettingsRequest } from '@compartment/contracts';
import {
  getOrganizationAuthSettings,
  updateOrganizationAuthSettings,
  type CompartmentRequester,
} from '@compartment/sdk';
import { createAuthenticatedRequester, requireOrganizationContext } from './context.service';
import type { AuthenticatedContext } from './context.types';

export async function readOrganizationAuthSettings(
  context: AuthenticatedContext,
): Promise<OrganizationAuthSettingsResponse> {
  return await getOrganizationAuthSettings(createOrganizationAuthSettingsRequester(context));
}

export async function updateCurrentOrganizationAuthSettings(
  context: AuthenticatedContext,
  input: UpdateOrganizationAuthSettingsRequest,
): Promise<OrganizationAuthSettingsResponse> {
  return await updateOrganizationAuthSettings(createOrganizationAuthSettingsRequester(context), input);
}

function createOrganizationAuthSettingsRequester(context: AuthenticatedContext): CompartmentRequester {
  return createAuthenticatedRequester(requireOrganizationContext(context), {
    includeCurrentOrganization: true,
  });
}
