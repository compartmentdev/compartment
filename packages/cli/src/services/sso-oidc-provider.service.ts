import type {
  ConfigureSsoOidcProviderRequest,
  DeleteSsoOidcProviderResponse,
  SsoOidcProviderListResponse,
  SsoOidcProviderResponse,
  UpdateSsoOidcProviderRequest,
} from '@compartment/contracts';
import {
  createSsoOidcProvider,
  listSsoOidcProviders,
  removeSsoOidcProvider,
  updateSsoOidcProvider,
  type CompartmentRequester,
} from '@compartment/sdk';
import { createAuthenticatedRequester, requireOrganizationContext } from './context.service';
import type { AuthenticatedContext } from './context.types';

export async function readOrganizationSsoOidcProviders(
  context: AuthenticatedContext,
): Promise<SsoOidcProviderListResponse> {
  return await listSsoOidcProviders(createSsoOidcRequester(context));
}

export async function createOrganizationSsoOidcProvider(
  context: AuthenticatedContext,
  input: ConfigureSsoOidcProviderRequest,
): Promise<SsoOidcProviderResponse> {
  return await createSsoOidcProvider(createSsoOidcRequester(context), input);
}

export async function updateOrganizationSsoOidcProvider(
  context: AuthenticatedContext,
  providerId: string,
  input: UpdateSsoOidcProviderRequest,
): Promise<SsoOidcProviderResponse> {
  return await updateSsoOidcProvider(createSsoOidcRequester(context), providerId, input);
}

export async function deleteOrganizationSsoOidcProvider(
  context: AuthenticatedContext,
  providerId: string,
): Promise<DeleteSsoOidcProviderResponse> {
  return await removeSsoOidcProvider(createSsoOidcRequester(context), providerId);
}

function createSsoOidcRequester(context: AuthenticatedContext): CompartmentRequester {
  return createAuthenticatedRequester(requireOrganizationContext(context), {
    includeCurrentOrganization: true,
  });
}
