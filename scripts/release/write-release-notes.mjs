import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { readRequiredOptionValue } from '../lib/options.mjs';
import { readRepositoryRoot } from '../lib/repository-root.mjs';
import { runMain } from '../lib/run-main.mjs';

const defaultChangelogPath = 'CHANGELOG.md';
const repositoryRoot = readRepositoryRoot(import.meta.url, 2);

export function readReleaseNotes({ changelogText, fallbackNotes, releaseVersion }) {
  const lines = changelogText.split(/\r?\n/u);
  const headingIndex = lines.findIndex((line) => isReleaseHeading(line, releaseVersion));
  if (headingIndex === -1) {
    return readFallbackNotes({
      fallbackNotes,
      missingNotesError: `Expected CHANGELOG.md to contain release notes for ${releaseVersion}.`,
    });
  }

  const nextHeadingIndex = lines.findIndex((line, index) => index > headingIndex && /^##\s+/u.test(line));
  const sectionEndIndex = nextHeadingIndex === -1 ? lines.length : nextHeadingIndex;
  const releaseNotes = trimBlankLines(lines.slice(headingIndex + 1, sectionEndIndex)).join('\n');
  if (releaseNotes !== '') {
    return `${releaseNotes}\n`;
  }

  return readFallbackNotes({
    fallbackNotes,
    missingNotesError: `Expected CHANGELOG.md release notes for ${releaseVersion} to be non-empty.`,
  });
}

export async function writeReleaseNotes({
  changelogPath = defaultChangelogPath,
  fallbackNotes,
  outputPath,
  releaseVersion,
}) {
  const changelogText = await readFile(resolve(repositoryRoot, changelogPath), 'utf8');
  const releaseNotes = readReleaseNotes({ changelogText, fallbackNotes, releaseVersion });
  const resolvedOutputPath = resolve(repositoryRoot, outputPath);
  await mkdir(dirname(resolvedOutputPath), { recursive: true });
  await writeFile(resolvedOutputPath, releaseNotes, 'utf8');
}

function isReleaseHeading(line, releaseVersion) {
  if (!line.startsWith('## ')) {
    return false;
  }

  const headingText = line.slice(3).trimStart();
  return (
    headingText === releaseVersion ||
    headingText === `v${releaseVersion}` ||
    headingText.startsWith(`${releaseVersion} `) ||
    headingText.startsWith(`v${releaseVersion} `) ||
    headingText.startsWith(`[${releaseVersion}]`) ||
    headingText.startsWith(`[v${releaseVersion}]`)
  );
}

function trimBlankLines(lines) {
  let startIndex = 0;
  let endIndex = lines.length;

  while (startIndex < endIndex && lines[startIndex].trim() === '') {
    startIndex += 1;
  }

  while (endIndex > startIndex && lines[endIndex - 1].trim() === '') {
    endIndex -= 1;
  }

  return lines.slice(startIndex, endIndex);
}

function readFallbackNotes({ fallbackNotes, missingNotesError }) {
  if (fallbackNotes === undefined) {
    throw new Error(missingNotesError);
  }

  const normalizedFallbackNotes = fallbackNotes.trim();
  if (normalizedFallbackNotes === '') {
    throw new Error('Expected fallback release notes to be non-empty.');
  }

  return `${normalizedFallbackNotes}\n`;
}

function readWriteReleaseNotesOptions(args) {
  const options = {
    changelogPath: defaultChangelogPath,
    fallbackNotes: undefined,
    outputPath: undefined,
    releaseVersion: undefined,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--changelog') {
      options.changelogPath = readRequiredOptionValue(args, ++index, '--changelog');
      continue;
    }
    if (argument === '--fallback-notes') {
      options.fallbackNotes = readRequiredOptionValue(args, ++index, '--fallback-notes');
      continue;
    }
    if (argument === '--output') {
      options.outputPath = readRequiredOptionValue(args, ++index, '--output');
      continue;
    }
    if (argument === '--version') {
      options.releaseVersion = readRequiredOptionValue(args, ++index, '--version');
      continue;
    }

    throw new Error(`Unknown write release notes argument: ${argument}`);
  }

  if (options.outputPath === undefined) {
    throw new Error('Expected --output.');
  }
  if (options.releaseVersion === undefined) {
    throw new Error('Expected --version.');
  }

  return {
    changelogPath: options.changelogPath,
    fallbackNotes: options.fallbackNotes,
    outputPath: options.outputPath,
    releaseVersion: options.releaseVersion,
  };
}

async function main(args) {
  await writeReleaseNotes(readWriteReleaseNotesOptions(args));
}

runMain(import.meta.url, process.argv[1], async () => await main(process.argv.slice(2)));
