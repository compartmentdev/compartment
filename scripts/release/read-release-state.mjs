import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { readGitHubReleaseCliOptions } from '../lib/github-release-options.mjs';
import { runMain } from '../lib/run-main.mjs';

const execFileAsync = promisify(execFile);

const releaseStates = {
  draft: 'draft',
  missing: 'missing',
  published: 'published',
};

export async function readReleaseState({ execFileImpl = execFileAsync, releaseRepository, releaseTag }) {
  try {
    const { stdout } = await execFileImpl('gh', [
      'release',
      'view',
      releaseTag,
      '--repo',
      releaseRepository,
      '--json',
      'isDraft',
    ]);
    const release = JSON.parse(stdout);

    if (release.isDraft === true) {
      return releaseStates.draft;
    }

    if (release.isDraft === false) {
      return releaseStates.published;
    }

    throw new Error(`Expected GitHub release ${releaseTag} to include boolean isDraft.`);
  } catch (error) {
    if (isReleaseNotFoundError(error)) {
      return releaseStates.missing;
    }

    throw new Error(formatReleaseStateError({ error, releaseRepository, releaseTag }));
  }
}

function isReleaseNotFoundError(error) {
  if (error === null || typeof error !== 'object') {
    return false;
  }

  const output = [error.stdout, error.stderr, error.message].filter((value) => typeof value === 'string').join('\n');
  return /release not found|not found|404/i.test(output);
}

function formatReleaseStateError({ error, releaseRepository, releaseTag }) {
  const details = [error.stdout, error.stderr, error.message]
    .filter((value) => typeof value === 'string' && value.trim() !== '')
    .join('\n');
  const errorDetails = details === '' ? 'No error output was captured from gh release view.' : details;
  return `Failed to read GitHub release ${releaseTag} in ${releaseRepository}.
${errorDetails}`;
}

function readReleaseStateOptions(args) {
  const { releaseRepository, releaseTag } = readGitHubReleaseCliOptions(args, {
    commandName: 'read release state',
    requiredUsage: 'Expected --repo <owner/repo> and --tag <tag>.',
  });
  return {
    releaseRepository,
    releaseTag,
  };
}

async function main(args) {
  const releaseState = await readReleaseState(readReleaseStateOptions(args));
  process.stdout.write(`${releaseState}\n`);
}

runMain(import.meta.url, process.argv[1], async () => await main(process.argv.slice(2)));
