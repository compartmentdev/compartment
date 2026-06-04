import { describe, expect, it } from 'vitest';

import { readReleaseState } from './read-release-state.mjs';

describe('read-release-state', () => {
  it('returns draft for a draft GitHub release', async () => {
    await expect(
      readReleaseState({
        execFileImpl: createGhReleaseView({ isDraft: true }),
        releaseRepository: 'compartmentdev/compartment',
        releaseTag: 'v0.9.0',
      }),
    ).resolves.toBe('draft');
  });

  it('returns published for a published GitHub release', async () => {
    await expect(
      readReleaseState({
        execFileImpl: createGhReleaseView({ isDraft: false }),
        releaseRepository: 'compartmentdev/compartment',
        releaseTag: 'v0.9.0',
      }),
    ).resolves.toBe('published');
  });

  it('returns missing for a missing GitHub release', async () => {
    await expect(
      readReleaseState({
        execFileImpl: async () => {
          const error = new Error('release not found');
          error.stderr = 'release not found';
          throw error;
        },
        releaseRepository: 'compartmentdev/compartment',
        releaseTag: 'v0.9.0',
      }),
    ).resolves.toBe('missing');
  });

  it('fails for non-404 GitHub CLI errors', async () => {
    await expect(
      readReleaseState({
        execFileImpl: async () => {
          const error = new Error('authentication required');
          error.stderr = 'HTTP 500: upstream unavailable';
          throw error;
        },
        releaseRepository: 'compartmentdev/compartment',
        releaseTag: 'v0.9.0',
      }),
    ).rejects.toThrow(`Failed to read GitHub release v0.9.0 in compartmentdev/compartment.
HTTP 500: upstream unavailable
authentication required`);
  });
});

function createGhReleaseView(release) {
  return async (command, args) => {
    expect(command).toBe('gh');
    expect(args).toEqual(['release', 'view', 'v0.9.0', '--repo', 'compartmentdev/compartment', '--json', 'isDraft']);

    return {
      stdout: JSON.stringify(release),
    };
  };
}
