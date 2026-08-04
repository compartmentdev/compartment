import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { assertReleaseVersion } from './check-release-version.mjs';

const temporaryDirectories = [];

describe('check-release-version', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.map(
        async (temporaryDirectory) => await rm(temporaryDirectory, { force: true, recursive: true }),
      ),
    );
    temporaryDirectories.length = 0;
  });

  it('accepts matching package, manifest, and chart versions', async () => {
    const repositoryRoot = await createReleaseVersionFixture({
      chartAppVersion: '0.2.0',
      manifestVersion: '0.2.0',
      packageVersions: ['0.2.0', '0.2.0'],
    });

    await expect(assertReleaseVersion({ releaseVersion: '0.2.0', repositoryRoot })).resolves.toEqual({
      packageCount: 2,
      releaseVersion: '0.2.0',
    });
  });

  it('reports every mismatched release version file', async () => {
    const repositoryRoot = await createReleaseVersionFixture({
      chartAppVersion: '0.5.0',
      manifestVersion: '0.4.0',
      packageVersions: ['0.2.0', '0.3.0'],
    });

    await expect(assertReleaseVersion({ releaseVersion: '0.2.0', repositoryRoot })).rejects
      .toThrow(`Release version mismatch:
- packages/b/package.json has version 0.3.0, expected 0.2.0
- .release-please-manifest.json has "."=0.4.0, expected 0.2.0
- deploy/chart/compartment/Chart.yaml has appVersion 0.5.0, expected 0.2.0`);
  });

  it('rejects a chart without a string appVersion', async () => {
    const repositoryRoot = await createReleaseVersionFixture({
      chartAppVersion: 2,
      manifestVersion: '0.2.0',
      packageVersions: ['0.2.0'],
    });

    await expect(assertReleaseVersion({ releaseVersion: '0.2.0', repositoryRoot })).rejects.toThrow(
      'Expected deploy/chart/compartment/Chart.yaml to define a non-empty string appVersion.',
    );
  });
});

async function createReleaseVersionFixture({ chartAppVersion, manifestVersion, packageVersions }) {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'compartment-release-version-'));
  temporaryDirectories.push(temporaryDirectory);
  await writeFile(
    join(temporaryDirectory, '.release-please-manifest.json'),
    `${JSON.stringify({ '.': manifestVersion }, null, 2)}\n`,
    'utf8',
  );
  const chartDirectory = join(temporaryDirectory, 'deploy/chart/compartment');
  await mkdir(chartDirectory, { recursive: true });
  await writeFile(
    join(chartDirectory, 'Chart.yaml'),
    `apiVersion: v2\nname: compartment\nversion: 0.1.0\nappVersion: ${JSON.stringify(chartAppVersion)}\n`,
    'utf8',
  );

  for (const [index, packageVersion] of packageVersions.entries()) {
    const packageDirectory = join(temporaryDirectory, 'packages', String.fromCharCode('a'.charCodeAt(0) + index));
    await mkdir(packageDirectory, { recursive: true });
    await writeFile(
      join(packageDirectory, 'package.json'),
      `${JSON.stringify({ name: `fixture-${index.toString()}`, version: packageVersion }, null, 2)}\n`,
      'utf8',
    );
  }

  return temporaryDirectory;
}
