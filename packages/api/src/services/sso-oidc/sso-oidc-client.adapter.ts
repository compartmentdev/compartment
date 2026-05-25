import type * as OpenidClient from 'openid-client';
import type {
  Configuration,
  CustomFetch,
  CustomFetchOptions,
  DiscoveryRequestOptions,
  IDToken,
  TokenEndpointResponse,
  TokenEndpointResponseHelpers,
  UserInfoResponse,
} from 'openid-client';
import type { SsoOidcIdentityClaimReference, SsoOidcIdentityVerificationConfig } from '@compartment/contracts';
import { createInvalidSsoLoginError, isApiBusinessError } from '../../errors/api-business-error';
import { createOidcTrustedOutboundFetch, isTrustedPublicOutboundHost } from '../outbound-http.service';
import type {
  OidcAuthorizationPlan,
  OidcAuthorizationRequest,
  OidcCallbackInput,
  OidcIdentityClaims,
} from './sso-oidc-client.adapter.types';
import { resolveOidcIdentityClaims } from './sso-oidc-identity-verification.service';
import type { OidcIdentityClaimSources } from './sso-oidc-identity-verification.service.types';

type OpenidClientModule = typeof OpenidClient;
type TokenEndpointResult = TokenEndpointResponse & TokenEndpointResponseHelpers;

export async function buildOidcAuthorizationPlan(input: OidcAuthorizationRequest): Promise<OidcAuthorizationPlan> {
  const client: OpenidClientModule = await import('openid-client');
  const config: Configuration = await discoverOidcConfiguration(client, input);
  const pkceCodeVerifier: string = client.randomPKCECodeVerifier();
  const codeChallenge: string = await client.calculatePKCECodeChallenge(pkceCodeVerifier);
  const state: string = client.randomState();
  const nonce: string = client.randomNonce();
  const authorizationUrl: URL = client.buildAuthorizationUrl(config, {
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    nonce,
    redirect_uri: input.redirectUri,
    scope: input.scope,
    state,
  });
  assertOidcAuthorizationUrlAllowed(authorizationUrl);

  return {
    authorizationUrl: authorizationUrl.toString(),
    nonce,
    pkceCodeVerifier,
    state,
  };
}

function assertOidcAuthorizationUrlAllowed(authorizationUrl: URL): void {
  if (
    authorizationUrl.protocol !== 'https:' ||
    authorizationUrl.username !== '' ||
    authorizationUrl.password !== '' ||
    !isTrustedPublicOutboundHost(authorizationUrl.host)
  ) {
    throw createInvalidSsoLoginError();
  }
}

export async function readOidcCallbackClaims(input: OidcCallbackInput): Promise<OidcIdentityClaims> {
  const claimSources: OidcIdentityClaimSources = await readOidcClaimSources(input);

  return resolveOidcIdentityClaims(claimSources, input.identityVerification);
}

async function readOidcClaimSources(input: OidcCallbackInput): Promise<OidcIdentityClaimSources> {
  try {
    const client: OpenidClientModule = await import('openid-client');
    const config: Configuration = await discoverOidcConfiguration(client, input);
    const tokens: TokenEndpointResult = await client.authorizationCodeGrant(config, input.currentUrl, {
      expectedNonce: input.expectedNonce,
      expectedState: input.expectedState,
      pkceCodeVerifier: input.pkceCodeVerifier,
    });
    const idToken: IDToken | undefined = tokens.claims();
    if (idToken === undefined) {
      throw createInvalidSsoLoginError();
    }

    return {
      idToken,
      userinfo: await readOidcUserInfo(client, config, tokens, idToken, input.identityVerification),
    };
  } catch (error) {
    if (isApiBusinessError(error as Error)) {
      throw error;
    }

    throw createInvalidSsoLoginError();
  }
}

async function discoverOidcConfiguration(
  client: OpenidClientModule,
  input: OidcAuthorizationRequest,
): Promise<Configuration> {
  const trustedFetch: CustomFetch = createOidcTrustedPublicFetch();
  const discoveryOptions: DiscoveryRequestOptions = {
    [client.customFetch]: trustedFetch,
  };
  const config: Configuration = await client.discovery(
    new URL(input.issuerUrl),
    input.clientId,
    input.clientSecret,
    undefined,
    discoveryOptions,
  );
  config[client.customFetch] = trustedFetch;

  return config;
}

function createOidcTrustedPublicFetch(): CustomFetch {
  const outboundFetch: typeof fetch = createOidcTrustedOutboundFetch();

  return async (url: string, options: CustomFetchOptions): Promise<Response> => {
    return await outboundFetch(url, buildOidcFetchRequestInit(options));
  };
}

function buildOidcFetchRequestInit(options: CustomFetchOptions): RequestInit {
  return {
    ...(options.body === undefined ? {} : { body: options.body }),
    headers: options.headers,
    method: options.method,
    redirect: options.redirect,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };
}

async function readOidcUserInfo(
  client: OpenidClientModule,
  config: Configuration,
  tokens: TokenEndpointResult,
  idToken: IDToken,
  identityVerification: SsoOidcIdentityVerificationConfig,
): Promise<UserInfoResponse | undefined> {
  if (!requiresUserInfo(identityVerification)) {
    return undefined;
  }

  return await client.fetchUserInfo(config, tokens.access_token, idToken.sub);
}

function requiresUserInfo(identityVerification: SsoOidcIdentityVerificationConfig): boolean {
  return [
    ...identityVerification.emailClaims,
    ...identityVerification.emailVerifiedClaims,
    ...identityVerification.verifiedEmailClaims,
  ].some((claimReference: SsoOidcIdentityClaimReference): boolean => claimReference.source === 'userinfo');
}
