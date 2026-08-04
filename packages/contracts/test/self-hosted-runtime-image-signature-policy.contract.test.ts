import { describe, expect, it } from 'vitest';
import { selfHostedRuntimeImageSignaturePolicy } from '../src/contracts/self-hosted-runtime-image-signature-policy.contract';

describe('self-hosted runtime image signature policy', (): void => {
  it('accepts only the Compartment publishing workflow identity', (): void => {
    const identity: RegExp = new RegExp(selfHostedRuntimeImageSignaturePolicy.certificateIdentityRegexp, 'u');

    expect(selfHostedRuntimeImageSignaturePolicy.cosignBundleFormatFlag).toBe('--new-bundle-format');
    expect(selfHostedRuntimeImageSignaturePolicy.certificateOidcIssuer).toBe(
      'https://token.actions.githubusercontent.com',
    );
    expect(
      identity.test(
        'https://github.com/compartmentdev/compartment/.github/workflows/publish-self-hosted-main.yml@refs/heads/main',
      ),
    ).toBe(true);
    expect(
      identity.test(
        'https://github.com/compartmentdev/compartment/.github/workflows/publish-self-hosted-release.yml@refs/tags/v1.2.3',
      ),
    ).toBe(true);
    expect(
      identity.test(
        'https://github.com/compartmentdev/compartment/.github/workflows/publish-onprem-main.yml@refs/heads/main',
      ),
    ).toBe(false);
    expect(
      identity.test(
        'https://github.com/compartmentdev/compartment/.github/workflows/publish-self-hosted-main.yml@refs/heads/feature-x',
      ),
    ).toBe(false);
    expect(
      identity.test(
        'https://github.com/another-owner/compartment/.github/workflows/publish-self-hosted-release.yml@refs/tags/v1.2.3',
      ),
    ).toBe(false);
  });
});
