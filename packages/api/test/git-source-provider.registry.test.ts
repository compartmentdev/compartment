import { describe, expect, it } from 'vitest';
import { getGitProviderAdapter } from '../src/services/git-source/git-source-provider.registry';
import type { GitProviderAdapter } from '../src/services/git-source/git-source-provider.types';

describe('git provider registry', (): void => {
  it.each(['toString', 'constructor', 'hasOwnProperty'])('rejects prototype key %s', (providerType: string): void => {
    expect((): GitProviderAdapter => getGitProviderAdapter(providerType)).toThrow('Unsupported git provider type');
  });
});
