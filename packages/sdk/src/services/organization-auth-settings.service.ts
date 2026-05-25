import {
  type OrganizationAuthSettingsResponse,
  type UpdateOrganizationAuthSettingsRequest,
  compartmentAuthSettingsPathname,
  organizationAuthSettingsResponseSchema,
  updateOrganizationAuthSettingsRequestSchema,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function getOrganizationAuthSettings(
  request: CompartmentRequester,
): Promise<OrganizationAuthSettingsResponse> {
  return await request<OrganizationAuthSettingsResponse, undefined>({
    method: 'GET',
    path: compartmentAuthSettingsPathname,
    schema: organizationAuthSettingsResponseSchema,
  });
}

export async function updateOrganizationAuthSettings(
  request: CompartmentRequester,
  body: UpdateOrganizationAuthSettingsRequest,
): Promise<OrganizationAuthSettingsResponse> {
  return await request<OrganizationAuthSettingsResponse, UpdateOrganizationAuthSettingsRequest>({
    body: updateOrganizationAuthSettingsRequestSchema.parse(body),
    method: 'PATCH',
    path: compartmentAuthSettingsPathname,
    schema: organizationAuthSettingsResponseSchema,
  });
}
