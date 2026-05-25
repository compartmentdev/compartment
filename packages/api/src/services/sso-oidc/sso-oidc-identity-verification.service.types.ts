import type { JsonValue } from 'openid-client';
import type { SsoOidcIdentityClaimSource } from '@compartment/contracts';

export type OidcClaimSet = Record<string, JsonValue | undefined>;

export interface OidcIdentityClaimSources {
  idToken: OidcClaimSet;
  userinfo?: OidcClaimSet | undefined;
}

export interface OidcResolvedEmailClaim {
  source: SsoOidcIdentityClaimSource;
  value: string;
  verified: boolean;
}
