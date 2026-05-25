import type { SsoOidcIdentityVerificationConfig } from '@compartment/contracts';

export interface OidcAuthorizationRequest {
  clientId: string;
  clientSecret: string;
  issuerUrl: string;
  redirectUri: string;
  scope: string;
}

export interface OidcAuthorizationPlan {
  authorizationUrl: string;
  nonce: string;
  pkceCodeVerifier: string;
  state: string;
}

export interface OidcCallbackInput extends OidcAuthorizationRequest {
  currentUrl: URL;
  expectedNonce: string;
  expectedState: string;
  identityVerification: SsoOidcIdentityVerificationConfig;
  pkceCodeVerifier: string;
}

export interface OidcIdentityClaims {
  email: string | null;
  emailVerified: boolean;
  issuer: string;
  subject: string;
}
