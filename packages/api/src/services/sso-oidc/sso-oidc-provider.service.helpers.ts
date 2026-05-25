import { findSsoOidcProviderById } from '../../queries/sso-oidc.query';
import type { SsoOidcProviderRow } from '../../queries/sso-oidc.query.types';

export async function findOwnedSsoOidcProvider(
  organizationId: string,
  providerId: string,
): Promise<SsoOidcProviderRow | undefined> {
  const provider: SsoOidcProviderRow | undefined = await findSsoOidcProviderById(providerId);
  if (provider?.organizationId !== organizationId) {
    return undefined;
  }

  return provider;
}
