import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readExtractedRepositoryRoot } from '../src/services/worker-git-source-archive.support';

const tempDirectories: string[] = [];

afterEach(async (): Promise<void> => {
  await Promise.all(
    tempDirectories.map(async (directory: string): Promise<void> => {
      await rm(directory, { force: true, recursive: true });
    }),
  );
  tempDirectories.length = 0;
});

describe('readExtractedRepositoryRoot', (): void => {
  it('rejects provider archives that extract more than one repository root directory', async (): Promise<void> => {
    const extractionDirectory: string = await createTrackedTempDirectory('compartment-worker-github-archive-');

    await Promise.all([
      mkdir(join(extractionDirectory, 'repo-a')),
      mkdir(join(extractionDirectory, 'repo-b')),
      writeFile(join(extractionDirectory, 'README.md'), 'ignored file\n', 'utf8'),
    ]);

    await expect(readExtractedRepositoryRoot(extractionDirectory)).rejects.toThrow(
      'Git provider repository archive contained multiple repository root directories.',
    );
  });
});

async function createTrackedTempDirectory(prefix: string): Promise<string> {
  const directory: string = await mkdtemp(join(tmpdir(), prefix));
  tempDirectories.push(directory);

  return directory;
}
