import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { prepareRelease } from './prepare.mjs';

const temporaryDirectories = [];

describe('prepare-release', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.map(
        async (temporaryDirectory) => await rm(temporaryDirectory, { force: true, recursive: true }),
      ),
    );
    temporaryDirectories.length = 0;
  });

  it('updates every version file used by stable release publishing', async () => {
    const repositoryRoot = await createReleaseFixture();

    await expect(prepareRelease({ releaseVersion: '0.2.0', repositoryRoot })).resolves.toEqual({
      packageCount: 2,
      releaseVersion: '0.2.0',
    });

    await expect(readJsonFile(join(repositoryRoot, 'packages/a/package.json'))).resolves.toMatchObject({
      version: '0.2.0',
    });
    await expect(readJsonFile(join(repositoryRoot, 'packages/b/package.json'))).resolves.toMatchObject({
      version: '0.2.0',
    });
    await expect(readFile(join(repositoryRoot, '.env.self-hosted.example'), 'utf8')).resolves.toContain(
      'COMPARTMENT_NODE_VERSION=0.2.0',
    );
    await expect(readJsonFile(join(repositoryRoot, '.release-please-manifest.json'))).resolves.toEqual({
      '.': '0.2.0',
    });
  });
});

async function createReleaseFixture() {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'compartment-prepare-release-'));
  temporaryDirectories.push(temporaryDirectory);

  await writeFile(join(temporaryDirectory, '.env.self-hosted.example'), 'COMPARTMENT_NODE_VERSION=0.1.0\n', 'utf8');
  await writeFile(
    join(temporaryDirectory, '.release-please-manifest.json'),
    `${JSON.stringify({ '.': '0.1.0' }, null, 2)}\n`,
    'utf8',
  );

  for (const packageName of ['a', 'b']) {
    const packageDirectory = join(temporaryDirectory, 'packages', packageName);
    await mkdir(packageDirectory, { recursive: true });
    await writeFile(
      join(packageDirectory, 'package.json'),
      `${JSON.stringify({ name: `fixture-${packageName}`, version: '0.1.0' }, null, 2)}\n`,
      'utf8',
    );
  }

  return temporaryDirectory;
}

async function readJsonFile(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}
