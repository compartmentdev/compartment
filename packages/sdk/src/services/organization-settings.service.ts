import {
  type OrganizationSettingsResponse,
  type UpdateOrganizationSettingsRequest,
  compartmentOrganizationSettingsPathname,
  organizationSettingsResponseSchema,
  updateOrganizationSettingsRequestSchema,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function getOrganizationSettings(request: CompartmentRequester): Promise<OrganizationSettingsResponse> {
  return await request<OrganizationSettingsResponse, undefined>({
    method: 'GET',
    path: compartmentOrganizationSettingsPathname,
    schema: organizationSettingsResponseSchema,
  });
}

export async function updateOrganizationSettings(
  request: CompartmentRequester,
  body: UpdateOrganizationSettingsRequest,
): Promise<OrganizationSettingsResponse> {
  return await request<OrganizationSettingsResponse, UpdateOrganizationSettingsRequest>({
    body: updateOrganizationSettingsRequestSchema.parse(body),
    method: 'PATCH',
    path: compartmentOrganizationSettingsPathname,
    schema: organizationSettingsResponseSchema,
  });
}
