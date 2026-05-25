import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  buildDefaultSsoOidcIdentityVerificationConfig,
  type SsoOidcIdentityVerificationConfig,
} from '@compartment/contracts';
import type { Database } from '../../src/db/client';
import { clearApiRuntime, configureApiRuntime } from '../../src/runtime/runtime';
import {
  buildOidcAuthorizationPlan,
  readOidcCallbackClaims,
} from '../../src/services/sso-oidc/sso-oidc-client.adapter';
import type {
  OidcAuthorizationRequest,
  OidcCallbackInput,
  OidcIdentityClaims,
} from '../../src/services/sso-oidc/sso-oidc-client.adapter.types';
import { createSsoOidcApiConfig } from './sso-oidc-login.service.fixtures';

interface OpenidClientMocks {
  authorizationCodeGrant: Mock;
  buildAuthorizationUrl: Mock;
  calculatePKCECodeChallenge: Mock;
  customFetch: symbol;
  discovery: Mock;
  fetchUserInfo: Mock;
  randomNonce: Mock;
  randomPKCECodeVerifier: Mock;
  randomState: Mock;
}

interface OutboundHttpTrustMocks {
  createOidcTrustedOutboundFetch: Mock;
  fetch: Mock;
  isTrustedPublicOutboundHost: Mock;
}

interface OidcTestIdTokenClaims {
  email?: string | undefined;
  email_verified?: boolean | undefined;
  iss: string;
  preferred_username?: string | undefined;
  sub: string;
  verified_primary_email?: string | undefined;
  xms_edov?: boolean | undefined;
}

interface OidcTestUserInfoClaims {
  email?: string | undefined;
  email_verified?: boolean | undefined;
  sub: string;
}

interface OidcTestTokenResult {
  access_token: string;
  claims: () => OidcTestIdTokenClaims;
}

interface OidcCallbackInputOverrides {
  identityVerification?: SsoOidcIdentityVerificationConfig | undefined;
}

class OidcTestTokenResultImpl implements OidcTestTokenResult {
  public readonly access_token: string = 'access-token';

  private readonly idTokenClaims: OidcTestIdTokenClaims;

  public constructor(idTokenClaims: OidcTestIdTokenClaims) {
    this.idTokenClaims = idTokenClaims;
  }

  public claims(): OidcTestIdTokenClaims {
    return this.idTokenClaims;
  }
}

const mocks: OpenidClientMocks = vi.hoisted(
  (): OpenidClientMocks => ({
    authorizationCodeGrant: vi.fn(),
    buildAuthorizationUrl: vi.fn(),
    calculatePKCECodeChallenge: vi.fn(),
    customFetch: Symbol('openid-client.customFetch'),
    discovery: vi.fn(),
    fetchUserInfo: vi.fn(),
    randomNonce: vi.fn(),
    randomPKCECodeVerifier: vi.fn(),
    randomState: vi.fn(),
  }),
);

const outboundHttpTrustMocks: OutboundHttpTrustMocks = vi.hoisted(
  (): OutboundHttpTrustMocks => ({
    createOidcTrustedOutboundFetch: vi.fn(),
    fetch: vi.fn(),
    isTrustedPublicOutboundHost: vi.fn(),
  }),
);

vi.mock(
  'openid-client',
  (): Record<string, Mock | symbol> => ({
    authorizationCodeGrant: mocks.authorizationCodeGrant,
    buildAuthorizationUrl: mocks.buildAuthorizationUrl,
    calculatePKCECodeChallenge: mocks.calculatePKCECodeChallenge,
    customFetch: mocks.customFetch,
    discovery: mocks.discovery,
    fetchUserInfo: mocks.fetchUserInfo,
    randomNonce: mocks.randomNonce,
    randomPKCECodeVerifier: mocks.randomPKCECodeVerifier,
    randomState: mocks.randomState,
  }),
);

vi.mock(
  '../../src/services/outbound-http.service',
  (): Record<string, Mock> => ({
    createOidcTrustedOutboundFetch: outboundHttpTrustMocks.createOidcTrustedOutboundFetch,
    isTrustedPublicOutboundHost: outboundHttpTrustMocks.isTrustedPublicOutboundHost,
  }),
);

describe('SSO OIDC client adapter', (): void => {
  beforeEach((): void => {
    Object.values(mocks).forEach((mock: Mock | symbol): void => {
      if (typeof mock !== 'symbol') {
        mock.mockReset();
      }
    });
    outboundHttpTrustMocks.createOidcTrustedOutboundFetch.mockReset();
    outboundHttpTrustMocks.fetch.mockReset();
    outboundHttpTrustMocks.isTrustedPublicOutboundHost.mockReset();
    outboundHttpTrustMocks.createOidcTrustedOutboundFetch.mockReturnValue(outboundHttpTrustMocks.fetch);
    outboundHttpTrustMocks.isTrustedPublicOutboundHost.mockImplementation((host: string): boolean => {
      return host === 'accounts.google.com';
    });
    configureApiRuntime({
      config: createSsoOidcApiConfig(),
      db: {} as Database,
    });
    mocks.buildAuthorizationUrl.mockReturnValue(
      new URL('https://accounts.google.com/o/oauth2/v2/auth?state=sso-state'),
    );
    mocks.calculatePKCECodeChallenge.mockResolvedValue('pkce-challenge');
    mocks.discovery.mockResolvedValue({});
    mocks.randomNonce.mockReturnValue('oidc-nonce');
    mocks.randomPKCECodeVerifier.mockReturnValue('pkce-verifier');
    mocks.randomState.mockReturnValue('sso-state');
  });

  afterEach((): void => {
    clearApiRuntime();
  });

  it('builds a trusted HTTPS authorization URL', async (): Promise<void> => {
    await expect(buildOidcAuthorizationPlan(createOidcAuthorizationRequest())).resolves.toEqual({
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=sso-state',
      nonce: 'oidc-nonce',
      pkceCodeVerifier: 'pkce-verifier',
      state: 'sso-state',
    });
  });

  it('rejects non-HTTP, non-HTTPS, credentialed, and untrusted authorization URLs', async (): Promise<void> => {
    for (const authorizationUrl of [
      new URL('javascript:alert(1)'),
      new URL('http://accounts.google.com/o/oauth2/v2/auth'),
      new URL('https://user:pass@accounts.google.com/o/oauth2/v2/auth'),
      new URL('https://evil.example/oauth2/auth'),
    ]) {
      mocks.buildAuthorizationUrl.mockReturnValueOnce(authorizationUrl);

      await expect(buildOidcAuthorizationPlan(createOidcAuthorizationRequest())).rejects.toThrow(
        'The SSO login could not be completed.',
      );
    }
  });

  it('maps openid-client callback failures to invalid_sso_login', async (): Promise<void> => {
    mocks.authorizationCodeGrant.mockRejectedValueOnce(new Error('oidc token exchange failed'));

    await expect(readOidcCallbackClaims(createOidcCallbackInput())).rejects.toThrow(
      'The SSO login could not be completed.',
    );
  });

  it('maps standard OIDC verified email claims', async (): Promise<void> => {
    mocks.authorizationCodeGrant.mockResolvedValueOnce(
      createOidcTokenResult({
        email: 'admin@example.com',
        email_verified: true,
        iss: 'https://accounts.google.com',
        sub: 'google-subject',
      }),
    );

    const claims: OidcIdentityClaims = await readOidcCallbackClaims(createOidcCallbackInput());

    expect(claims).toEqual({
      email: 'admin@example.com',
      emailVerified: true,
      issuer: 'https://accounts.google.com',
      subject: 'google-subject',
    });
    expect(mocks.fetchUserInfo).not.toHaveBeenCalled();
  });

  it('maps Microsoft Entra domain-owner verification claims', async (): Promise<void> => {
    mocks.authorizationCodeGrant.mockResolvedValueOnce(
      createOidcTokenResult({
        email: 'owner@example.com',
        iss: 'https://login.microsoftonline.com/2e323c1c-c0ca-4af2-87e8-1324709faafa/v2.0',
        sub: 'microsoft-subject',
        xms_edov: true,
      }),
    );

    const claims: OidcIdentityClaims = await readOidcCallbackClaims(
      createOidcCallbackInput({
        identityVerification: createMicrosoftIdentityVerification(),
      }),
    );

    expect(claims).toEqual({
      email: 'owner@example.com',
      emailVerified: true,
      issuer: 'https://login.microsoftonline.com/2e323c1c-c0ca-4af2-87e8-1324709faafa/v2.0',
      subject: 'microsoft-subject',
    });
  });

  it('uses Microsoft Entra verified primary email when the email claim is absent', async (): Promise<void> => {
    mocks.authorizationCodeGrant.mockResolvedValueOnce(
      createOidcTokenResult({
        iss: 'https://login.microsoftonline.com/2e323c1c-c0ca-4af2-87e8-1324709faafa/v2.0',
        sub: 'microsoft-subject',
        verified_primary_email: 'owner@example.com',
      }),
    );

    const claims: OidcIdentityClaims = await readOidcCallbackClaims(
      createOidcCallbackInput({
        identityVerification: createMicrosoftIdentityVerification(),
      }),
    );

    expect(claims).toEqual({
      email: 'owner@example.com',
      emailVerified: true,
      issuer: 'https://login.microsoftonline.com/2e323c1c-c0ca-4af2-87e8-1324709faafa/v2.0',
      subject: 'microsoft-subject',
    });
  });

  it('does not use Microsoft Entra ID-token verification for UserInfo email without matching ID-token email', async (): Promise<void> => {
    mocks.authorizationCodeGrant.mockResolvedValueOnce(
      createOidcTokenResult({
        iss: 'https://login.microsoftonline.com/2e323c1c-c0ca-4af2-87e8-1324709faafa/v2.0',
        sub: 'microsoft-subject',
        xms_edov: true,
      }),
    );
    mocks.fetchUserInfo.mockResolvedValueOnce(
      createUserInfoClaims({
        email: 'owner@example.com',
        sub: 'microsoft-subject',
      }),
    );

    const claims: OidcIdentityClaims = await readOidcCallbackClaims(
      createOidcCallbackInput({
        identityVerification: createMicrosoftIdentityVerification(),
      }),
    );

    expect(claims).toEqual({
      email: 'owner@example.com',
      emailVerified: false,
      issuer: 'https://login.microsoftonline.com/2e323c1c-c0ca-4af2-87e8-1324709faafa/v2.0',
      subject: 'microsoft-subject',
    });
  });

  it('uses cross-source verification when the verification source has the same email', async (): Promise<void> => {
    mocks.authorizationCodeGrant.mockResolvedValueOnce(
      createOidcTokenResult({
        email: 'admin@example.com',
        email_verified: true,
        iss: 'https://idp.example.com',
        sub: 'userinfo-subject',
      }),
    );
    mocks.fetchUserInfo.mockResolvedValueOnce(
      createUserInfoClaims({
        email: 'admin@example.com',
        sub: 'userinfo-subject',
      }),
    );

    const claims: OidcIdentityClaims = await readOidcCallbackClaims(
      createOidcCallbackInput({
        identityVerification: createCrossSourceUserInfoIdentityVerification(),
      }),
    );

    expect(claims).toEqual({
      email: 'admin@example.com',
      emailVerified: true,
      issuer: 'https://idp.example.com',
      subject: 'userinfo-subject',
    });
  });

  it('rejects cross-source verification when the verification source has a different email', async (): Promise<void> => {
    mocks.authorizationCodeGrant.mockResolvedValueOnce(
      createOidcTokenResult({
        email: 'attacker@example.com',
        email_verified: true,
        iss: 'https://idp.example.com',
        sub: 'userinfo-subject',
      }),
    );
    mocks.fetchUserInfo.mockResolvedValueOnce(
      createUserInfoClaims({
        email: 'admin@example.com',
        sub: 'userinfo-subject',
      }),
    );

    const claims: OidcIdentityClaims = await readOidcCallbackClaims(
      createOidcCallbackInput({
        identityVerification: createCrossSourceUserInfoIdentityVerification(),
      }),
    );

    expect(claims).toEqual({
      email: 'admin@example.com',
      emailVerified: false,
      issuer: 'https://idp.example.com',
      subject: 'userinfo-subject',
    });
  });

  it('uses UserInfo when identity verification references UserInfo claims', async (): Promise<void> => {
    mocks.authorizationCodeGrant.mockResolvedValueOnce(
      createOidcTokenResult({
        iss: 'https://idp.example.com',
        sub: 'userinfo-subject',
      }),
    );
    mocks.fetchUserInfo.mockResolvedValueOnce(
      createUserInfoClaims({
        email: 'admin@example.com',
        email_verified: true,
        sub: 'userinfo-subject',
      }),
    );

    const claims: OidcIdentityClaims = await readOidcCallbackClaims(
      createOidcCallbackInput({
        identityVerification: createUserInfoIdentityVerification(),
      }),
    );

    expect(claims).toEqual({
      email: 'admin@example.com',
      emailVerified: true,
      issuer: 'https://idp.example.com',
      subject: 'userinfo-subject',
    });
  });

  it('does not treat preferred_username as a verified email by default', async (): Promise<void> => {
    mocks.authorizationCodeGrant.mockResolvedValueOnce(
      createOidcTokenResult({
        email_verified: true,
        iss: 'https://login.microsoftonline.com/2e323c1c-c0ca-4af2-87e8-1324709faafa/v2.0',
        preferred_username: 'owner@example.com',
        sub: 'microsoft-subject',
      }),
    );

    const claims: OidcIdentityClaims = await readOidcCallbackClaims(createOidcCallbackInput());

    expect(claims).toEqual({
      email: null,
      emailVerified: false,
      issuer: 'https://login.microsoftonline.com/2e323c1c-c0ca-4af2-87e8-1324709faafa/v2.0',
      subject: 'microsoft-subject',
    });
  });
});

function createOidcAuthorizationRequest(): OidcAuthorizationRequest {
  return {
    clientId: 'client-id',
    clientSecret: 'client-secret',
    issuerUrl: 'https://accounts.google.com',
    redirectUri: 'https://compartment.localhost/login/sso/callback',
    scope: 'openid email profile',
  };
}

function createOidcCallbackInput(overrides: OidcCallbackInputOverrides = {}): OidcCallbackInput {
  return {
    clientId: 'client-id',
    clientSecret: 'client-secret',
    currentUrl: new URL('https://compartment.localhost/login/sso/callback?code=oidc-code&state=sso-state'),
    expectedNonce: 'oidc-nonce',
    expectedState: 'sso-state',
    identityVerification: overrides.identityVerification ?? buildDefaultSsoOidcIdentityVerificationConfig(),
    issuerUrl: 'https://accounts.google.com',
    pkceCodeVerifier: 'pkce-verifier',
    redirectUri: 'https://compartment.localhost/login/sso/callback',
    scope: 'openid email profile',
  };
}

function createOidcTokenResult(claims: OidcTestIdTokenClaims): OidcTestTokenResult {
  return new OidcTestTokenResultImpl(claims);
}

function createUserInfoClaims(claims: OidcTestUserInfoClaims): OidcTestUserInfoClaims {
  return claims;
}

function createMicrosoftIdentityVerification(): SsoOidcIdentityVerificationConfig {
  return {
    emailClaims: [
      { claim: 'email', source: 'id_token' },
      { claim: 'email', source: 'userinfo' },
    ],
    emailVerifiedClaims: [{ claim: 'xms_edov', equals: true, source: 'id_token' }],
    verifiedEmailClaims: [{ claim: 'verified_primary_email', source: 'id_token' }],
  };
}

function createUserInfoIdentityVerification(): SsoOidcIdentityVerificationConfig {
  return {
    emailClaims: [{ claim: 'email', source: 'userinfo' }],
    emailVerifiedClaims: [{ claim: 'email_verified', equals: true, source: 'userinfo' }],
    verifiedEmailClaims: [],
  };
}

function createCrossSourceUserInfoIdentityVerification(): SsoOidcIdentityVerificationConfig {
  return {
    emailClaims: [
      { claim: 'email', source: 'userinfo' },
      { claim: 'email', source: 'id_token' },
    ],
    emailVerifiedClaims: [{ claim: 'email_verified', equals: true, source: 'id_token' }],
    verifiedEmailClaims: [],
  };
}
