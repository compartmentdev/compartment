import { describe, expect, it } from 'vitest';
import { requireRailpackSecretsFingerprint } from '../src/docker-build-secrets';

describe('requireRailpackSecretsFingerprint', (): void => {
  it('passes an opaque keyed fingerprint without receiving the fingerprint key', (): void => {
    const fingerprint: string = 'a'.repeat(64);
    expect(requireRailpackSecretsFingerprint({ TOKEN: 'secret' }, fingerprint)).toBe(fingerprint);
  });

  it('requires a keyed fingerprint whenever build secrets are present', (): void => {
    expect((): string | null => requireRailpackSecretsFingerprint({ TOKEN: 'secret' }, undefined)).toThrow(
      'A keyed build secret fingerprint is required when build secrets are present.',
    );
    expect((): string | null => requireRailpackSecretsFingerprint({ TOKEN: 'secret' }, 'plaintext')).toThrow(
      'A keyed build secret fingerprint is required when build secrets are present.',
    );
    expect(requireRailpackSecretsFingerprint({}, undefined)).toBeNull();
  });
});
