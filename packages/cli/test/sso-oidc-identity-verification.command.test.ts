import { describe, expect, it } from 'vitest';
import { buildSsoOidcIdentityVerificationConfig } from '../src/commands/sso/sso-oidc-identity-verification.command';

describe('buildSsoOidcIdentityVerificationConfig', (): void => {
  it('parses OIDC identity verification flags into helper-owned config', (): void => {
    expect(
      buildSsoOidcIdentityVerificationConfig({
        emailClaims: 'id-token:email,userinfo:http://schemas.example.com/email',
        emailVerifiedClaims: 'id-token:xms_edov=true',
        verifiedEmailClaims: 'id-token:verified_primary_email',
      }),
    ).toEqual({
      emailClaims: [
        { claim: 'email', source: 'id_token' },
        { claim: 'http://schemas.example.com/email', source: 'userinfo' },
      ],
      emailVerifiedClaims: [{ claim: 'xms_edov', equals: true, source: 'id_token' }],
      verifiedEmailClaims: [{ claim: 'verified_primary_email', source: 'id_token' }],
    });
  });
});
