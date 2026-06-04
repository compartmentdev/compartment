import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';

import { readRequiredOptionValue } from '../lib/options.mjs';
import { runMain } from '../lib/run-main.mjs';

const execFileAsync = promisify(execFile);

export async function assertReleaseAssets({ assetPaths, publishedAssets, releaseTag, repairHint }) {
  const assetDigestByName = new Map(
    publishedAssets.map((asset) => [asset.name, typeof asset.digest === 'string' ? asset.digest : '']),
  );
  const missingAssets = [];
  const missingDigests = [];
  const mismatchedAssets = [];

  for (const assetPath of assetPaths) {
    const assetName = basename(assetPath);
    const actualDigest = assetDigestByName.get(assetName);
    const expectedDigest = `sha256:${await readSha256Digest(assetPath)}`;

    if (actualDigest === undefined) {
      missingAssets.push(assetName);
      continue;
    }

    if (actualDigest === '') {
      missingDigests.push(assetName);
      continue;
    }

    if (actualDigest !== expectedDigest) {
      mismatchedAssets.push(assetName);
    }
  }

  if (missingAssets.length === 0 && missingDigests.length === 0 && mismatchedAssets.length === 0) {
    return {
      assetCount: assetPaths.length,
      releaseTag,
    };
  }

  const details = [];
  if (missingAssets.length !== 0) {
    details.push(`Missing assets: ${missingAssets.join(', ')}`);
  }
  if (missingDigests.length !== 0) {
    details.push(`Missing asset digests: ${missingDigests.join(', ')}`);
  }
  if (mismatchedAssets.length !== 0) {
    details.push(`Mismatched assets: ${mismatchedAssets.join(', ')}`);
  }

  throw new Error(formatReleaseAssetValidationError({ details, releaseTag, repairHint }));
}

async function readGitHubReleaseAssets({ releaseRepository, releaseTag }) {
  const { stdout } = await execFileAsync('gh', [
    'release',
    'view',
    releaseTag,
    '--repo',
    releaseRepository,
    '--json',
    'assets',
  ]);
  const release = JSON.parse(stdout);
  if (!Array.isArray(release.assets)) {
    throw new Error(`Expected GitHub release ${releaseTag} to include an assets array.`);
  }

  return release.assets.map((asset) => ({
    digest: typeof asset.digest === 'string' ? asset.digest : '',
    name: typeof asset.name === 'string' ? asset.name : '',
  }));
}

async function readSha256Digest(path) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

function formatReleaseAssetValidationError({ details, releaseTag, repairHint }) {
  const detailText = details.join('\n');
  return `Release ${releaseTag} is already published with missing or mismatched immutable assets.
${detailText}
${repairHint}`;
}

function readValidateReleaseAssetsOptions(args) {
  let releaseRepository;
  let releaseTag;
  let repairHint = 'Publish a new release instead of clobbering immutable assets.';
  const assetPaths = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--repo') {
      releaseRepository = readRequiredOptionValue(args, ++index, '--repo');
      continue;
    }

    if (argument === '--tag') {
      releaseTag = readRequiredOptionValue(args, ++index, '--tag');
      continue;
    }

    if (argument === '--repair-hint') {
      repairHint = readRequiredOptionValue(args, ++index, '--repair-hint');
      continue;
    }

    if (argument.startsWith('--')) {
      throw new Error(`Unknown validate release assets argument: ${argument}`);
    }

    assetPaths.push(resolve(process.cwd(), argument));
  }

  if (releaseRepository === undefined || releaseTag === undefined || assetPaths.length === 0) {
    throw new Error('Expected --repo <owner/repo>, --tag <tag>, and one or more asset paths.');
  }

  return {
    assetPaths,
    releaseRepository,
    releaseTag,
    repairHint,
  };
}

async function main(args) {
  const options = readValidateReleaseAssetsOptions(args);
  const publishedAssets = await readGitHubReleaseAssets(options);
  const result = await assertReleaseAssets({
    assetPaths: options.assetPaths,
    publishedAssets,
    releaseTag: options.releaseTag,
    repairHint: options.repairHint,
  });

  process.stdout.write(`Validated ${result.assetCount.toString()} immutable asset(s) for ${result.releaseTag}.\n`);
}

runMain(import.meta.url, process.argv[1], async () => await main(process.argv.slice(2)));
