import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { readRepositoryRoot } from '../lib/repository-root.mjs';

export function findDrizzleMigrationCountValidationErrors(migrationChanges) {
  if (migrationChanges.length <= 1) {
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
