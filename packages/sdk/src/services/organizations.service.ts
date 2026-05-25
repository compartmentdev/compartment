import {
  compartmentOrganizationListPathname,
  compartmentOrganizationsPathname,
  createOrganizationResponseSchema,
  organizationListResponseSchema,
  type CreateOrganizationRequest,
  type CreateOrganizationResponse,
  type OrganizationListResponse,
} from '@compartment/contracts';

import type { CompartmentRequester } from '../http/request.types';

export async function listOrganizations(request: CompartmentRequester): Promise<OrganizationListResponse> {
  return await request<OrganizationListResponse, undefined>({
    method: 'GET',
    path: compartmentOrganizationListPathname,
    schema: organizationListResponseSchema,
  });
}

export async function createOrganization(
  request: CompartmentRequester,
  body: CreateOrganizationRequest,
): Promise<CreateOrganizationResponse> {
  return await request<CreateOrganizationResponse, CreateOrganizationRequest>({
    body,
    method: 'POST',
    path: compartmentOrganizationsPathname,
    schema: createOrganizationResponseSchema,
  });
}
