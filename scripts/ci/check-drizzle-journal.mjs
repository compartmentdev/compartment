import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { readRepositoryRoot } from '../lib/repository-root.mjs';

const apiBaselineResetJournalPath = 'packages/api/drizzle/meta/_journal.json';
const apiBaselineResetBaseEntryCount = 51;
const apiBaselineResetBaseLastTag = '0050_wooden_timeslip';
const apiBaselineResetHeadTag = '0000_initial';
const apiBaselineResetDialect = 'postgresql';
const apiBaselineResetVersion = '7';

export function readDrizzleMigrationJournal(rawJournal) {
  return JSON.parse(rawJournal);
}

export function findDrizzleJournalDiffValidationErrors(journalPath, baseJournal, headJournal) {
  const validationErrors = [];

  if (isApiBaselineJournalReset(journalPath, baseJournal, headJournal)) {
    return validationErrors;
  }

  if (headJournal.entries.length < baseJournal.entries.length) {
    validationErrors.push(`${journalPath}: pull requests must not remove existing journal entries.`);
    return validationErrors;
  }

  for (let index = 0; index < baseJournal.entries.length; index += 1) {
    const baseEntry = baseJournal.entries[index];
    const headEntry = headJournal.entries[index];

    if (JSON.stringify(baseEntry) !== JSON.stringify(headEntry)) {
      validationErrors.push(
        `${journalPath}: existing entry ${baseEntry.tag} at idx=${baseEntry.idx} was modified; append new entries instead of rewriting applied migration history.`,
      );
      return validationErrors;
    }
  }

  let maxSeenWhenEntry = readMaxWhenEntry(baseJournal.entries);

  for (let index = baseJournal.entries.length; index < headJournal.entries.length; index += 1) {
    const entry = headJournal.entries[index];

    if (entry.idx !== index) {
      validationErrors.push(`${journalPath}: appended entry ${entry.tag} has idx=${entry.idx}, expected idx=${index}.`);
    }

    if (maxSeenWhenEntry !== undefined && entry.when <= maxSeenWhenEntry.when) {
      validationErrors.push(
        `${journalPath}: appended entry ${entry.tag} has when=${entry.when}, which must be greater than ${maxSeenWhenEntry.tag} when=${maxSeenWhenEntry.when}.`,
      );
    }

    maxSeenWhenEntry = readNextMaxWhenEntry(maxSeenWhenEntry, entry);
  }

  return validationErrors;
}

function isApiBaselineJournalReset(journalPath, baseJournal, headJournal) {
  if (journalPath !== apiBaselineResetJournalPath) {
    return false;
  }

  if (
    baseJournal.dialect !== apiBaselineResetDialect ||
    headJournal.dialect !== apiBaselineResetDialect ||
    baseJournal.version !== apiBaselineResetVersion ||
    headJournal.version !== apiBaselineResetVersion
  ) {
    return false;
  }

  if (baseJournal.entries.length !== apiBaselineResetBaseEntryCount || headJournal.entries.length !== 1) {
    return false;
  }

  const baseLastEntry = baseJournal.entries[baseJournal.entries.length - 1];
  const [entry] = headJournal.entries;
  return (
    baseLastEntry?.tag === apiBaselineResetBaseLastTag &&
    entry.idx === 0 &&
    entry.tag === apiBaselineResetHeadTag &&
    entry.when === baseLastEntry.when
  );
}

function readMaxWhenEntry(entries) {
  return entries.reduce((currentMaxEntry, entry) => readNextMaxWhenEntry(currentMaxEntry, entry), undefined);
}

function readNextMaxWhenEntry(currentMaxEntry, entry) {
  return currentMaxEntry === undefined || entry.when > currentMaxEntry.when ? entry : currentMaxEntry;
}

export function listChangedDrizzleJournalPaths(repoRoot, baseRef, headRef) {
  const diffOutput = execFileSync(
    'git',
    [
      'diff',
      '--name-only',
      '--diff-filter=ACDMRTUXB',
      baseRef,
      headRef,
      '--',
      ':(glob)packages/*/drizzle/meta/_journal.json',
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    },
  );

  return diffOutput
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

function gitPathExists(repoRoot, ref, path) {
  try {
    execFileSync('git', ['cat-file', '-e', `${ref}:${path}`], { cwd: repoRoot, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function readGitFile(repoRoot, ref, path) {
  return execFileSync('git', ['show', `${ref}:${path}`], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function readGitJournal(repoRoot, ref, path) {
  return gitPathExists(repoRoot, ref, path) ? readDrizzleMigrationJournal(readGitFile(repoRoot, ref, path)) : undefined;
}

export function readPackageRootFromDrizzleJournalPath(journalPath) {
  const marker = '/drizzle/meta/_journal.json';
  if (!journalPath.endsWith(marker)) {
    throw new Error(`Expected Drizzle journal path, received: ${journalPath}`);
  }

  return journalPath.slice(0, -marker.length);
}

function isDeletedPackageJournalChange(repoRoot, headRef, journalPath) {
  const packageRoot = readPackageRootFromDrizzleJournalPath(journalPath);
  return !gitPathExists(repoRoot, headRef, `${packageRoot}/package.json`);
}

function main() {
  const [, , baseRef, headRef] = process.argv;
  if (baseRef === undefined || headRef === undefined) {
    throw new Error('Usage: node ./scripts/ci/check-drizzle-journal.mjs <base-ref> <head-ref>');
  }

  const repoRoot = readRepositoryRoot(import.meta.url, 2);
  const changedJournalPaths = listChangedDrizzleJournalPaths(repoRoot, baseRef, headRef);
  const validationErrors = [];

  for (const journalPath of changedJournalPaths) {
    if (isDeletedPackageJournalChange(repoRoot, headRef, journalPath)) {
      continue;
    }

    const baseJournalFromGit = readGitJournal(repoRoot, baseRef, journalPath);
    const headJournalFromGit = readGitJournal(repoRoot, headRef, journalPath);

    if (baseJournalFromGit === undefined && headJournalFromGit === undefined) {
      validationErrors.push(
        `${journalPath}: journal was reported as changed but is missing from both ${baseRef} and ${headRef}.`,
      );
      continue;
    }

    const headJournal = headJournalFromGit ?? {
      dialect: baseJournalFromGit.dialect,
      entries: [],
      version: baseJournalFromGit.version,
    };
    const baseJournal = baseJournalFromGit ?? {
      dialect: headJournal.dialect,
      entries: [],
      version: headJournal.version,
    };

    validationErrors.push(...findDrizzleJournalDiffValidationErrors(journalPath, baseJournal, headJournal));
  }

  if (validationErrors.length > 0) {
    throw new Error(`Drizzle journal validation failed.\n${validationErrors.join('\n')}`);
  }

  process.stdout.write(`Validated ${changedJournalPaths.length} changed Drizzle journal file(s).\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
