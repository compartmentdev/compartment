import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { assertReleaseAssets } from './validate-release-assets.mjs';

const temporaryDirectories = [];

describe('validate-release-assets', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.map(
        async (temporaryDirectory) => await rm(temporaryDirectory, { force: true, recursive: true }),
      ),
    );
    temporaryDirectories.length = 0;
  });

  it('accepts published assets with matching digests', async () => {
    const assetPaths = await createAssetFiles({
      'checksums.txt': 'checksums',
      'install.sh': '#!/bin/sh\n',
    });

    await expect(
      assertReleaseAssets({
        assetPaths,
        publishedAssets: await createPublishedAssets(assetPaths),
        releaseTag: 'v0.9.0',
        repairHint: 'Publish a new release tag instead.',
      }),
    ).resolves.toEqual({
      assetCount: 2,
      releaseTag: 'v0.9.0',
    });
  });

  it('reports missing, undigested, and mismatched immutable assets together', async () => {
    const assetPaths = await createAssetFiles({
      'checksums.txt': 'checksums',
      'compartment-linux-x64.tar.gz': 'tarball',
      'install.sh': '#!/bin/sh\n',
    });

    await expect(
      assertReleaseAssets({
        assetPaths,
        publishedAssets: [
          {
            digest: '',
            name: 'checksums.txt',
          },
          {
            digest: 'sha256:bad',
            name: 'install.sh',
          },
        ],
        releaseTag: 'v0.9.0',
        repairHint: 'Publish a new release tag instead.',
      }),
    ).rejects.toThrow(`Release v0.9.0 is already published with missing or mismatched immutable assets.
Missing assets: compartment-linux-x64.tar.gz
Missing asset digests: checksums.txt
Mismatched assets: install.sh
Publish a new release tag instead.`);
  });
});

async function createAssetFiles(assetContents) {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'compartment-release-assets-'));
  temporaryDirectories.push(temporaryDirectory);
  const assetPaths = [];

  for (const [assetName, contents] of Object.entries(assetContents)) {
    const assetPath = join(temporaryDirectory, assetName);
    await writeFile(assetPath, contents, 'utf8');
    assetPaths.push(assetPath);
  }

  return assetPaths;
}

async function createPublishedAssets(assetPaths) {
  return await Promise.all(
    assetPaths.map(async (assetPath) => ({
      digest: `sha256:${createHash('sha256')
        .update(await readFile(assetPath))
        .digest('hex')}`,
      name: basename(assetPath),
    })),
  );
}
