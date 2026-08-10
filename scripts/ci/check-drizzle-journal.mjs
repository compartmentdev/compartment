import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';

import { readRepositoryRoot } from '../lib/repository-root.mjs';
import { runMain } from '../lib/run-main.mjs';

export function readDrizzleMigrationJournal(rawJournal) {
  return JSON.parse(rawJournal);
}

// One-time exemption for the D16 reinstall-only Docker→Kubernetes cutover squash.
// It matches only the exact pre-squash packages/api journal history, so any future
// baseline reset needs its own explicit decision and exemption.
const DOCKER_CUTOVER_SQUASH_JOURNAL_PATH = 'packages/api/drizzle/meta/_journal.json';
const DOCKER_CUTOVER_SQUASH_BASE_ENTRIES = [
  { idx: 0, tag: '0000_initial', when: 1779700755038 },
  { idx: 1, tag: '0001_even_ravenous', when: 1783786185100 },
  { idx: 2, tag: '0002_tearful_yellow_claw', when: 1783863046900 },
  { idx: 3, tag: '0003_polite_sir_ram', when: 1783882325446 },
  { idx: 4, tag: '0004_greedy_overlord', when: 1783934368212 },
];

// One-time exemption for the D16 baseline regeneration after the Docker→Kubernetes
// cutover. Only the generated timestamp changed; any other journal difference still
// needs its own explicit decision and exemption.
const D16_REGENERATED_BASELINE_ORIGINAL_WHEN = 1779700755038;
const D16_REGENERATED_BASELINE_NEW_WHEN = 1783948017382;

// One-time exemption for folding the retention columns from #165 back into the
// reinstall-only Kubernetes baseline. Match the complete journals so this cannot
// authorize another history rewrite.
const KUBERNETES_RETENTION_RESQUASH_BASE_JOURNAL = {
  version: '7',
  dialect: 'postgresql',
  entries: [
    { idx: 0, version: '7', when: 1783948017382, tag: '0000_initial', breakpoints: true },
    { idx: 1, version: '7', when: 1784734906421, tag: '0001_living_spirit', breakpoints: true },
  ],
};
const KUBERNETES_RETENTION_RESQUASH_HEAD_JOURNAL = {
  version: '7',
  dialect: 'postgresql',
  entries: [{ idx: 0, version: '7', when: 1783948017382, tag: '0000_initial', breakpoints: true }],
};

// One-time exemption for replacing the complete transitional Kubernetes history
// with the Phase 8 reinstall-only final-state baseline.
const KUBERNETES_ACCEPTANCE_RESQUASH_BASE_JOURNAL = {
  version: '7',
  dialect: 'postgresql',
  entries: [
    { idx: 0, version: '7', when: 1783948017382, tag: '0000_initial', breakpoints: true },
    { idx: 1, version: '7', when: 1784909278511, tag: '0001_concerned_ben_urich', breakpoints: true },
    { idx: 2, version: '7', when: 1785223501177, tag: '0002_thankful_krista_starr', breakpoints: true },
    { idx: 3, version: '7', when: 1785239564368, tag: '0003_thick_gravity', breakpoints: true },
    { idx: 4, version: '7', when: 1785261363115, tag: '0004_mixed_slyde', breakpoints: true },
    { idx: 5, version: '7', when: 1785281013566, tag: '0005_bright_cardiac', breakpoints: true },
  ],
};
const KUBERNETES_ACCEPTANCE_RESQUASH_HEAD_JOURNAL = {
  version: '7',
  dialect: 'postgresql',
  entries: [{ idx: 0, version: '7', when: 1785301596023, tag: '0000_initial', breakpoints: true }],
};

function isApprovedKubernetesAcceptanceResquash(journalPath, baseJournal, headJournal) {
  return (
    journalPath === DOCKER_CUTOVER_SQUASH_JOURNAL_PATH &&
    isDeepStrictEqual(baseJournal, KUBERNETES_ACCEPTANCE_RESQUASH_BASE_JOURNAL) &&
    isDeepStrictEqual(headJournal, KUBERNETES_ACCEPTANCE_RESQUASH_HEAD_JOURNAL)
  );
}

function isApprovedKubernetesRetentionResquash(journalPath, baseJournal, headJournal) {
  return (
    journalPath === DOCKER_CUTOVER_SQUASH_JOURNAL_PATH &&
    isDeepStrictEqual(baseJournal, KUBERNETES_RETENTION_RESQUASH_BASE_JOURNAL) &&
    isDeepStrictEqual(headJournal, KUBERNETES_RETENTION_RESQUASH_HEAD_JOURNAL)
  );
}

function isApprovedD16RegeneratedBaselineTimestamp(journalPath, baseJournal, headJournal) {
  if (
    journalPath !== DOCKER_CUTOVER_SQUASH_JOURNAL_PATH ||
    baseJournal.entries.length !== 1 ||
    headJournal.entries.length !== 1
  ) {
    return false;
  }

  const baseEntry = baseJournal.entries[0];
  const headEntry = headJournal.entries[0];
  if (
    baseEntry.idx !== 0 ||
    baseEntry.tag !== '0000_initial' ||
    baseEntry.when !== D16_REGENERATED_BASELINE_ORIGINAL_WHEN ||
    headEntry.when !== D16_REGENERATED_BASELINE_NEW_WHEN
  ) {
    return false;
  }

  const baseJournalWithRegeneratedWhen = {
    ...baseJournal,
    entries: [{ ...baseEntry, when: D16_REGENERATED_BASELINE_NEW_WHEN }],
  };
  return isDeepStrictEqual(baseJournalWithRegeneratedWhen, headJournal);
}

export function isApprovedDockerCutoverJournalSquash(journalPath, baseJournal, headJournal) {
  if (journalPath !== DOCKER_CUTOVER_SQUASH_JOURNAL_PATH) {
    return false;
  }

  if (baseJournal.entries.length !== DOCKER_CUTOVER_SQUASH_BASE_ENTRIES.length) {
    return false;
  }

  const baseMatchesSquashBaseline = DOCKER_CUTOVER_SQUASH_BASE_ENTRIES.every((expectedEntry, index) => {
    const baseEntry = baseJournal.entries[index];
    return (
      baseEntry.idx === expectedEntry.idx &&
      baseEntry.tag === expectedEntry.tag &&
      baseEntry.when === expectedEntry.when
    );
  });
  if (!baseMatchesSquashBaseline) {
    return false;
  }

  if (headJournal.entries.length !== 1) {
    return false;
  }

  const headEntry = headJournal.entries[0];
  return (
    headEntry.idx === 0 &&
    headEntry.tag === '0000_initial' &&
    headEntry.when > readMaxWhenEntry(baseJournal.entries).when
  );
}

export function findDrizzleJournalDiffValidationErrors(journalPath, baseJournal, headJournal) {
  const validationErrors = [];

  if (isApprovedKubernetesAcceptanceResquash(journalPath, baseJournal, headJournal)) {
    return validationErrors;
  }

  if (isApprovedKubernetesRetentionResquash(journalPath, baseJournal, headJournal)) {
    return validationErrors;
  }

  if (isApprovedD16RegeneratedBaselineTimestamp(journalPath, baseJournal, headJournal)) {
    return validationErrors;
  }

  if (isApprovedDockerCutoverJournalSquash(journalPath, baseJournal, headJournal)) {
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

runMain(import.meta.url, process.argv[1], main);
