import { describe, expect, it } from 'vitest';

import { findDrizzleMigrationCountValidationErrors, parseGitNameStatus } from './check-drizzle-migration-count.mjs';

describe('parseGitNameStatus', () => {
  it('reads the current path from git name-status output', () => {
    expect(parseGitNameStatus('M\tpackages/api/drizzle/0000_initial.sql\n')).toEqual([
      {
        path: 'packages/api/drizzle/0000_initial.sql',
        status: 'M',
      },
    ]);

    expect(parseGitNameStatus('R100\tpackages/api/drizzle/0001_old.sql\tpackages/api/drizzle/0001_new.sql\n')).toEqual([
      {
        path: 'packages/api/drizzle/0001_new.sql',
        status: 'R100',
      },
    ]);
  });
});

describe('findDrizzleMigrationCountValidationErrors', () => {
  it('allows the one-time docker cutover migration reset', () => {
    expect(findDrizzleMigrationCountValidationErrors(buildDockerCutoverResetChanges())).toEqual([]);
  });

  it('rejects the docker cutover reset when it carries an extra migration', () => {
    const validationErrors = findDrizzleMigrationCountValidationErrors([
      ...buildDockerCutoverResetChanges(),
      {
        path: 'packages/api/drizzle/0001_next.sql',
        status: 'A',
      },
    ]);

    expect(validationErrors[0]).toBe('Pull requests may change at most one migration file, but found 6.');
    expect(validationErrors.at(-1)).toBe('Squash the PR migrations into a single file before merge.');
  });

  it('rejects the docker cutover reset when the initial migration is added instead of rewritten', () => {
    const migrationChanges = buildDockerCutoverResetChanges().map((migrationChange) =>
      migrationChange.path === 'packages/api/drizzle/0000_initial.sql'
        ? { ...migrationChange, status: 'A' }
        : migrationChange,
    );

    expect(findDrizzleMigrationCountValidationErrors(migrationChanges)[0]).toBe(
      'Pull requests may change at most one migration file, but found 5.',
    );
  });

  it('allows a single migration change', () => {
    expect(
      findDrizzleMigrationCountValidationErrors([
        {
          path: 'packages/api/drizzle/0001_next.sql',
          status: 'A',
        },
      ]),
    ).toEqual([]);
  });

  it('rejects the completed API baseline SQL reset path', () => {
    const validationErrors = findDrizzleMigrationCountValidationErrors(buildApiBaselineResetChanges());

    expect(validationErrors[0]).toBe('Pull requests may change at most one migration file, but found 51.');
    expect(validationErrors).toContain('- packages/api/drizzle/0000_initial.sql');
    expect(validationErrors).toContain('- packages/api/drizzle/0050_wooden_timeslip.sql');
    expect(validationErrors.at(-1)).toBe('Squash the PR migrations into a single file before merge.');
  });

  it('rejects multiple unrelated migration changes', () => {
    expect(
      findDrizzleMigrationCountValidationErrors([
        {
          path: 'packages/api/drizzle/0001_first.sql',
          status: 'A',
        },
        {
          path: 'packages/api/drizzle/0002_second.sql',
          status: 'A',
        },
      ]),
    ).toEqual([
      'Pull requests may change at most one migration file, but found 2.',
      '- packages/api/drizzle/0001_first.sql',
      '- packages/api/drizzle/0002_second.sql',
      '',
      'Squash the PR migrations into a single file before merge.',
    ]);
  });
});

function buildDockerCutoverResetChanges() {
  return [
    {
      path: 'packages/api/drizzle/0000_initial.sql',
      status: 'M',
    },
    {
      path: 'packages/api/drizzle/0001_even_ravenous.sql',
      status: 'D',
    },
    {
      path: 'packages/api/drizzle/0002_tearful_yellow_claw.sql',
      status: 'D',
    },
    {
      path: 'packages/api/drizzle/0003_polite_sir_ram.sql',
      status: 'D',
    },
    {
      path: 'packages/api/drizzle/0004_greedy_overlord.sql',
      status: 'D',
    },
  ];
}

function buildApiBaselineResetChanges() {
  return Array.from({ length: 51 }, (_, index) => {
    if (index === 0) {
      return {
        path: 'packages/api/drizzle/0000_initial.sql',
        status: 'M',
      };
    }

    return {
      path:
        index === 50
          ? 'packages/api/drizzle/0050_wooden_timeslip.sql'
          : `packages/api/drizzle/${String(index).padStart(4, '0')}_previous.sql`,
      status: 'D',
    };
  });
}
