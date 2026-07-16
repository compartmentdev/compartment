import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { readRepositoryRoot } from '../lib/repository-root.mjs';
import { runMain } from '../lib/run-main.mjs';
import { readReleaseVersion, readWorkspacePackageJsonPaths } from './release-version-files.mjs';

const defaultRepositoryRoot = readRepositoryRoot(import.meta.url, 2);

export async function prepareRelease({ releaseVersion, repositoryRoot = defaultRepositoryRoot }) {
  const normalizedReleaseVersion = readReleaseVersion(releaseVersion);
  const packageJsonPaths = await readWorkspacePackageJsonPaths(repositoryRoot);

  await Promise.all(
    packageJsonPaths.map((packageJsonPath) => updatePackageVersion(packageJsonPath, normalizedReleaseVersion)),
  );
  await updateReleasePleaseManifestVersion(repositoryRoot, normalizedReleaseVersion);

  return {
    packageCount: packageJsonPaths.length,
    releaseVersion: normalizedReleaseVersion,
  };
}

async function main(args) {
  const result = await prepareRelease({ releaseVersion: args[0] });

  process.stdout.write(
    `Prepared release ${result.releaseVersion} in ${result.packageCount} workspace package manifests and .release-please-manifest.json.\n`,
  );
}

async function updatePackageVersion(packageJsonPath, releaseVersion) {
  const packageJsonText = await readFile(packageJsonPath, 'utf8');
  const packageJson = JSON.parse(packageJsonText);
  packageJson.version = releaseVersion;
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
}

async function updateReleasePleaseManifestVersion(repositoryRoot, releaseVersion) {
  const manifestPath = resolve(repositoryRoot, '.release-please-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (typeof manifest['.'] !== 'string') {
    throw new Error('Expected .release-please-manifest.json to define ".".');
  }

  manifest['.'] = releaseVersion;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

runMain(import.meta.url, process.argv[1], async () => await main(process.argv.slice(2)));
