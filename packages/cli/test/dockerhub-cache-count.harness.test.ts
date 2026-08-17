import { describe, expect, it } from 'vitest';
import { parseDockerHubCacheBlobCount } from './dockerhub-cache-count.harness';

describe('Docker Hub cache blob count parsing', (): void => {
  it('accepts the complete trimmed numeric output', (): void => {
    expect(parseDockerHubCacheBlobCount(' 12\n')).toBe(12);
  });

  it.each(['12 garbage', '12\n13', '', '9007199254740992'])(
    'rejects malformed or unsafe output %j',
    (output: string): void => {
      expect((): number => parseDockerHubCacheBlobCount(output)).toThrow('Expected a Docker Hub cache blob count');
    },
  );
});
