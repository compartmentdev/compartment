import { verifyBuildSourceArchiveCredential } from '@compartment/utils';
import { describe, expect, it } from 'vitest';
import { issueBuildJobSourceArchiveCredential } from '../src/build-source-archive-credential';

const controlTokenParts: readonly [string, string, string] = ['installation', 'runtime', 'control'];
const controlToken: string = controlTokenParts.join('-');
const buildTimeoutMs: number = 1_800_000;
const buildTimeoutSeconds: number = 1_800;
const graceSeconds: number = 300;

describe('build Job source archive credential lifetime', (): void => {
  it('stays valid through the whole Job deadline and dies one grace period later', (): void => {
    const credential: string = issueBuildJobSourceArchiveCredential(controlToken, 'art_a', buildTimeoutMs, 1_000);

    expect(verify(credential, 1_000 + buildTimeoutSeconds)).toBe(true);
    expect(verify(credential, 1_000 + buildTimeoutSeconds + graceSeconds)).toBe(true);
    expect(verify(credential, 1_000 + buildTimeoutSeconds + graceSeconds + 1)).toBe(false);
  });

  it('tracks the configured build timeout rather than a fixed lifetime', (): void => {
    const shortBuild: string = issueBuildJobSourceArchiveCredential(controlToken, 'art_a', 60_000, 1_000);

    expect(verify(shortBuild, 1_000 + 60 + graceSeconds)).toBe(true);
    expect(verify(shortBuild, 1_000 + 60 + graceSeconds + 1)).toBe(false);
  });

  it('pins the credential to the artifact the build may read', (): void => {
    const credential: string = issueBuildJobSourceArchiveCredential(controlToken, 'art_a', buildTimeoutMs, 1_000);

    expect(verifyBuildSourceArchiveCredential(controlToken, credential, 'art_b', 1_100)).toBe(false);
  });
});

function verify(credential: string, nowSeconds: number): boolean {
  return verifyBuildSourceArchiveCredential(controlToken, credential, 'art_a', nowSeconds);
}
