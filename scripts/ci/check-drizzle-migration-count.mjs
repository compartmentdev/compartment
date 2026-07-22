import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { readRepositoryRoot } from '../lib/repository-root.mjs';

// One-time exemption for the D16 reinstall-only Docker→Kubernetes cutover squash.
// It matches only the exact pre-squash packages/api migration file set, so any future
// baseline reset needs its own explicit decision and exemption.
const DOCKER_CUTOVER_SQUASH_REWRITTEN_PATH = 'packages/api/drizzle/0000_initial.sql';
const DOCKER_CUTOVER_SQUASH_DELETED_PATHS = [
  'packages/api/drizzle/0001_even_ravenous.sql',
  'packages/api/drizzle/0002_tearful_yellow_claw.sql',
  'packages/api/drizzle/0003_polite_sir_ram.sql',
  'packages/api/drizzle/0004_greedy_overlord.sql',
];

// One-time exemption for folding #165's retention migration back into the
// reinstall-only Kubernetes baseline.
const KUBERNETES_RETENTION_RESQUASH_REWRITTEN_PATH = 'packages/api/drizzle/0000_initial.sql';
const KUBERNETES_RETENTION_RESQUASH_DELETED_PATH = 'packages/api/drizzle/0001_living_spirit.sql';

function isApprovedKubernetesRetentionResquash(migrationChanges) {
  return (
    migrationChanges.length === 2 &&
    migrationChanges.some(
      (migrationChange) =>
        migrationChange.path === KUBERNETES_RETENTION_RESQUASH_REWRITTEN_PATH && migrationChange.status === 'M',
    ) &&
    migrationChanges.some(
      (migrationChange) =>
        migrationChange.path === KUBERNETES_RETENTION_RESQUASH_DELETED_PATH && migrationChange.status === 'D',
    )
  );
}

export function isApprovedDockerCutoverMigrationReset(migrationChanges) {
  if (migrationChanges.length !== DOCKER_CUTOVER_SQUASH_DELETED_PATHS.length + 1) {
    return false;
  }

  const rewrittenChanges = migrationChanges.filter(
    (migrationChange) => migrationChange.path === DOCKER_CUTOVER_SQUASH_REWRITTEN_PATH,
  );
  if (rewrittenChanges.length !== 1 || rewrittenChanges[0].status !== 'M') {
    return false;
  }

  return DOCKER_CUTOVER_SQUASH_DELETED_PATHS.every((deletedPath) =>
    migrationChanges.some((migrationChange) => migrationChange.path === deletedPath && migrationChange.status === 'D'),
  );
}

export function findDrizzleMigrationCountValidationErrors(migrationChanges) {
  if (migrationChanges.length <= 1) {
    return [];
  }

  if (isApprovedDockerCutoverMigrationReset(migrationChanges)) {
    return [];
  }

  if (isApprovedKubernetesRetentionResquash(migrationChanges)) {
    return [];
  }

  return [
    `Pull requests may change at most one migration file, but found ${migrationChanges.length}.`,
    ...migrationChanges.map((migrationChange) => `- ${migrationChange.path}`),
    '',
    'Squash the PR migrations into a single file before merge.',
  ];
}

export function parseGitNameStatus(rawNameStatus) {
  return rawNameStatus
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const [status, ...paths] = line.split('\t');
      return {
        path: paths[paths.length - 1],
        status,
      };
    });
}

function listChangedPackageMigrationFiles(repoRoot, baseRef, headRef) {
  const rawNameStatus = execFileSync(
    'git',
    ['diff', '--name-status', '--diff-filter=ACDMRTUXB', baseRef, headRef, '--', ':(glob)packages/*/drizzle/*.sql'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    },
  );

  return parseGitNameStatus(rawNameStatus).filter((migrationChange) =>
    existsSync(join(repoRoot, readPackageRootFromMigrationPath(migrationChange.path), 'package.json')),
  );
}

function readPackageRootFromMigrationPath(migrationPath) {
  const marker = '/drizzle/';
  const markerIndex = migrationPath.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error(`Expected Drizzle migration path, received: ${migrationPath}`);
  }

  return migrationPath.slice(0, markerIndex);
}

function main() {
  const [, , baseRef, headRef] = process.argv;
  if (baseRef === undefined || headRef === undefined) {
    throw new Error('Usage: node ./scripts/ci/check-drizzle-migration-count.mjs <base-ref> <head-ref>');
  }

  const repoRoot = readRepositoryRoot(import.meta.url, 2);
  const migrationChanges = listChangedPackageMigrationFiles(repoRoot, baseRef, headRef);
  const validationErrors = findDrizzleMigrationCountValidationErrors(migrationChanges);

  if (validationErrors.length > 0) {
    throw new Error(validationErrors.join('\n'));
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
