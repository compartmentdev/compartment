import {
  compartmentSsoOidcProvidersPathname,
  configureSsoOidcProviderRequestSchema,
  deleteSsoOidcProviderResponseSchema,
  ssoOidcProviderListResponseSchema,
  ssoOidcProviderResponseSchema,
  type ConfigureSsoOidcProviderRequest,
  type DeleteSsoOidcProviderResponse,
  type SsoOidcProviderListResponse,
  type SsoOidcProviderResponse,
  type UpdateSsoOidcProviderRequest,
  updateSsoOidcProviderRequestSchema,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function listSsoOidcProviders(request: CompartmentRequester): Promise<SsoOidcProviderListResponse> {
  return await request<SsoOidcProviderListResponse, undefined>({
    method: 'GET',
    path: compartmentSsoOidcProvidersPathname,
    schema: ssoOidcProviderListResponseSchema,
  });
}

export async function createSsoOidcProvider(
  request: CompartmentRequester,
  body: ConfigureSsoOidcProviderRequest,
): Promise<SsoOidcProviderResponse> {
  return await request<SsoOidcProviderResponse, ConfigureSsoOidcProviderRequest>({
    body: configureSsoOidcProviderRequestSchema.parse(body),
    method: 'POST',
    path: compartmentSsoOidcProvidersPathname,
    schema: ssoOidcProviderResponseSchema,
  });
}

export async function updateSsoOidcProvider(
  request: CompartmentRequester,
  providerId: string,
  body: UpdateSsoOidcProviderRequest,
): Promise<SsoOidcProviderResponse> {
  return await request<SsoOidcProviderResponse, UpdateSsoOidcProviderRequest>({
    body: updateSsoOidcProviderRequestSchema.parse(body),
    method: 'PATCH',
    path: `${compartmentSsoOidcProvidersPathname}/${encodeURIComponent(providerId)}`,
    schema: ssoOidcProviderResponseSchema,
  });
}

export async function removeSsoOidcProvider(
  request: CompartmentRequester,
  providerId: string,
): Promise<DeleteSsoOidcProviderResponse> {
  return await request<DeleteSsoOidcProviderResponse, undefined>({
    method: 'DELETE',
    path: `${compartmentSsoOidcProvidersPathname}/${encodeURIComponent(providerId)}`,
    schema: deleteSsoOidcProviderResponseSchema,
  });
}
