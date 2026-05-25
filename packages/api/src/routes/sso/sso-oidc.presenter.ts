import type {
  SsoOidcProviderListResponse,
  SsoOidcProviderResponse,
  SsoOidcProviderSummary,
} from '@compartment/contracts';
import type { SsoOidcProviderResult } from '../../services/sso-oidc/sso-oidc.service.types';

export function buildSsoOidcProviderResponse(provider: SsoOidcProviderResult | null): SsoOidcProviderResponse {
  return {
    provider: provider === null ? null : buildSsoOidcProviderSummary(provider),
  };
}

function buildSsoOidcProviderSummary(provider: SsoOidcProviderResult): SsoOidcProviderSummary {
  return {
    buttonText: provider.buttonText,
    clientId: provider.clientId,
    createdAt: provider.createdAt.toISOString(),
    displayName: provider.displayName,
    id: provider.id,
    identityVerification: provider.identityVerification,
    issuerUrl: provider.issuerUrl,
    key: provider.key,
    preset: provider.preset,
    provisioning: provider.provisioning,
    scope: provider.scope,
    updatedAt: provider.updatedAt.toISOString(),
  };
}

export function buildSsoOidcProviderListResponse(providers: SsoOidcProviderResult[]): SsoOidcProviderListResponse {
  return {
    providers: providers.map(buildSsoOidcProviderSummary),
  };
}
