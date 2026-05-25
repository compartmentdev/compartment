import { relative } from 'node:path';

import { readRequiredOptionValue } from '../lib/options.mjs';
import { readRepositoryRoot } from '../lib/repository-root.mjs';
import { runMain } from '../lib/run-main.mjs';
import {
  readPackageVersion,
  readReleasePleaseManifestVersion,
  readReleaseVersion,
  readSelfHostedExampleVersion,
  readWorkspacePackageJsonPaths,
} from './release-version-files.mjs';

const repositoryRoot = readRepositoryRoot(import.meta.url, 2);

export async function assertReleaseVersion({ releaseVersion, repositoryRoot }) {
  const normalizedReleaseVersion = readReleaseVersion(releaseVersion);
  const packageJsonPaths = await readWorkspacePackageJsonPaths(repositoryRoot);
  const mismatches = [];

  for (const packageJsonPath of packageJsonPaths) {
    const packageVersion = await readPackageVersion(packageJsonPath);
    if (packageVersion !== normalizedReleaseVersion) {
      mismatches.push(
        `${relative(repositoryRoot, packageJsonPath)} has version ${packageVersion}, expected ${normalizedReleaseVersion}`,
      );
    }
  }

  const selfHostedExampleVersion = await readSelfHostedExampleVersion(repositoryRoot);
  if (selfHostedExampleVersion !== normalizedReleaseVersion) {
    mismatches.push(
      `.env.self-hosted.example has COMPARTMENT_NODE_VERSION=${selfHostedExampleVersion}, expected ${normalizedReleaseVersion}`,
    );
  }

  const manifestVersion = await readReleasePleaseManifestVersion(repositoryRoot);
  if (manifestVersion !== normalizedReleaseVersion) {
    mismatches.push(`.release-please-manifest.json has "."=${manifestVersion}, expected ${normalizedReleaseVersion}`);
  }

  if (mismatches.length !== 0) {
    throw new Error(`Release version mismatch:\n- ${mismatches.join('\n- ')}`);
  }

  return {
    packageCount: packageJsonPaths.length,
    releaseVersion: normalizedReleaseVersion,
  };
}

function readCheckReleaseVersionOptions(args) {
  const options = {
    releaseVersion: undefined,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--version') {
      options.releaseVersion = readRequiredOptionValue(args, ++index, '--version');
      continue;
    }

    throw new Error(`Unknown check release version argument: ${argument}`);
  }

  if (options.releaseVersion === undefined) {
    throw new Error('Expected --version.');
  }

  return {
    releaseVersion: options.releaseVersion,
  };
}

async function main(args) {
  const options = readCheckReleaseVersionOptions(args);
  const result = await assertReleaseVersion({
    releaseVersion: options.releaseVersion,
    repositoryRoot,
  });

  process.stdout.write(
    `Release version ${result.releaseVersion} matches ${result.packageCount.toString()} package manifests, .env.self-hosted.example, and .release-please-manifest.json.\n`,
  );
}

runMain(import.meta.url, process.argv[1], async () => await main(process.argv.slice(2)));
