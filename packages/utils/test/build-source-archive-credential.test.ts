import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { issueBuildSourceArchiveCredential, verifyBuildSourceArchiveCredential } from '../src';

const runtimeControlTokenParts: readonly [string, string, string] = ['installation', 'runtime', 'control'];
const runtimeControlToken: string = runtimeControlTokenParts.join('-');
const otherInstallationToken: string = ['another', ...runtimeControlTokenParts].join('-');

describe('build source archive credentials', (): void => {
  it('rejects a credential issued for another build artifact', (): void => {
    const credential: string = issueBuildSourceArchiveCredential(runtimeControlToken, 'art_a', 1_000);

    expect(verifyBuildSourceArchiveCredential(runtimeControlToken, credential, 'art_a', 900)).toBe(true);
    expect(verifyBuildSourceArchiveCredential(runtimeControlToken, credential, 'art_b', 900)).toBe(false);
    expect(verifyBuildSourceArchiveCredential(runtimeControlToken, credential, 'art_a2', 900)).toBe(false);
    expect(verifyBuildSourceArchiveCredential(runtimeControlToken, credential, 'art_', 900)).toBe(false);
    expect(verifyBuildSourceArchiveCredential(runtimeControlToken, credential, '', 900)).toBe(false);
  });

  it('rejects a credential after it expires', (): void => {
    const credential: string = issueBuildSourceArchiveCredential(runtimeControlToken, 'art_a', 1_000);

    expect(verifyBuildSourceArchiveCredential(runtimeControlToken, credential, 'art_a', 1_000)).toBe(true);
    expect(verifyBuildSourceArchiveCredential(runtimeControlToken, credential, 'art_a', 1_001)).toBe(false);
    expect(verifyBuildSourceArchiveCredential(runtimeControlToken, credential, 'art_a', 60_000)).toBe(false);
  });

  it('rejects a credential minted under another installation secret', (): void => {
    const credential: string = issueBuildSourceArchiveCredential(otherInstallationToken, 'art_a', 1_000);

    expect(verifyBuildSourceArchiveCredential(runtimeControlToken, credential, 'art_a', 900)).toBe(false);
  });

  it('rejects a payload edited to widen its own scope or lifetime', (): void => {
    const credential: string = issueBuildSourceArchiveCredential(runtimeControlToken, 'art_a', 1_000);
    const [, signature]: (string | undefined)[] = credential.split('.');

    expect(
      verifyBuildSourceArchiveCredential(runtimeControlToken, forge('art_b', 1_000, signature), 'art_b', 900),
    ).toBe(false);
    expect(
      verifyBuildSourceArchiveCredential(runtimeControlToken, forge('art_a', 60_000, signature), 'art_a', 30_000),
    ).toBe(false);
  });

  it('rejects a credential whose signature is altered', (): void => {
    const credential: string = issueBuildSourceArchiveCredential(runtimeControlToken, 'art_a', 1_000);
    const [payloadText, signature]: (string | undefined)[] = credential.split('.');

    expect(verifyBuildSourceArchiveCredential(runtimeControlToken, `${payloadText ?? ''}.`, 'art_a', 900)).toBe(false);
    expect(
      verifyBuildSourceArchiveCredential(runtimeControlToken, `${payloadText ?? ''}.${signature ?? ''}x`, 'art_a', 900),
    ).toBe(false);
    expect(
      verifyBuildSourceArchiveCredential(
        runtimeControlToken,
        `${payloadText ?? ''}.${(signature ?? '').slice(0, -1)}`,
        'art_a',
        900,
      ),
    ).toBe(false);
  });

  it('does not accept the installation control token itself as a credential', (): void => {
    expect(verifyBuildSourceArchiveCredential(runtimeControlToken, runtimeControlToken, 'art_a', 900)).toBe(false);
  });

  it('rejects malformed and unsupported credential shapes', (): void => {
    const credential: string = issueBuildSourceArchiveCredential(runtimeControlToken, 'art_a', 1_000);

    expect(verifyBuildSourceArchiveCredential(runtimeControlToken, undefined, 'art_a', 900)).toBe(false);
    expect(verifyBuildSourceArchiveCredential(runtimeControlToken, '', 'art_a', 900)).toBe(false);
    expect(verifyBuildSourceArchiveCredential(runtimeControlToken, `${credential}.extra`, 'art_a', 900)).toBe(false);
    expect(verifyBuildSourceArchiveCredential(runtimeControlToken, signPayload('not-json'), 'art_a', 900)).toBe(false);
    expect(
      verifyBuildSourceArchiveCredential(
        runtimeControlToken,
        signPayload(JSON.stringify({ artifactId: 'art_a', expiresAt: 1_000, version: 2 })),
        'art_a',
        900,
      ),
    ).toBe(false);
    expect(
      verifyBuildSourceArchiveCredential(
        runtimeControlToken,
        signPayload(JSON.stringify({ artifactId: 'art_a', version: 1 })),
        'art_a',
        900,
      ),
    ).toBe(false);
  });

  it('refuses to mint a credential without a pinned artifact or an integer expiry', (): void => {
    expect((): string => issueBuildSourceArchiveCredential(runtimeControlToken, '', 1_000)).toThrow('artifact id');
    expect((): string => issueBuildSourceArchiveCredential(runtimeControlToken, ' ', 1_000)).toThrow('artifact id');
    expect((): string => issueBuildSourceArchiveCredential(runtimeControlToken, 'art_a', 1.5)).toThrow(
      'integer expiry',
    );
    expect((): string => issueBuildSourceArchiveCredential(runtimeControlToken, 'art_a', Number.NaN)).toThrow(
      'integer expiry',
    );
  });
});

function forge(artifactId: string, expiresAt: number, signature: string | undefined): string {
  const payloadText: string = Buffer.from(JSON.stringify({ artifactId, expiresAt, version: 1 }), 'utf8').toString(
    'base64url',
  );
  return `${payloadText}.${signature ?? ''}`;
}

/**
 * Signs an arbitrary payload the way an installation holding the control token would, so the cases below
 * exercise the payload guard rather than stopping at the signature check.
 */
function signPayload(payload: string): string {
  const payloadText: string = Buffer.from(payload, 'utf8').toString('base64url');
  const signingKey: Buffer = createHmac('sha256', runtimeControlToken)
    .update('compartment-build-source-archive-v1')
    .digest();
  return `${payloadText}.${createHmac('sha256', signingKey).update(payloadText).digest('base64url')}`;
}
