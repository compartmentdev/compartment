import { describe, expect, it } from 'vitest';

import {
  findDrizzleJournalDiffValidationErrors,
  readPackageRootFromDrizzleJournalPath,
} from './check-drizzle-journal.mjs';

describe('readPackageRootFromDrizzleJournalPath', () => {
  it('reads the owning package root for a Drizzle journal', () => {
    expect(readPackageRootFromDrizzleJournalPath('packages/api/drizzle/meta/_journal.json')).toBe('packages/api');
  });

  it('rejects non-journal paths', () => {
    expect(() => readPackageRootFromDrizzleJournalPath('packages/api/drizzle/0001.sql')).toThrow(
      'Expected Drizzle journal path',
    );
  });
});

describe('findDrizzleJournalDiffValidationErrors', () => {
  it('still rejects removed journal entries for existing package journals', () => {
    const baseJournal = {
      dialect: 'postgresql',
      entries: [{ idx: 0, tag: '0000_initial', when: 1 }],
      version: '7',
    };
    const headJournal = {
      dialect: 'postgresql',
      entries: [],
      version: '7',
    };

    expect(
      findDrizzleJournalDiffValidationErrors('packages/api/drizzle/meta/_journal.json', baseJournal, headJournal),
    ).toEqual(['packages/api/drizzle/meta/_journal.json: pull requests must not remove existing journal entries.']);
  });

  it('rejects future multi-entry journals being reset again', () => {
    const baseJournal = {
      dialect: 'postgresql',
      entries: [
        { idx: 0, tag: '0000_initial', when: 1 },
        { idx: 1, tag: '0001_next', when: 2 },
      ],
      version: '7',
    };
    const headJournal = {
      dialect: 'postgresql',
      entries: [{ idx: 0, tag: '0000_initial', when: 3 }],
      version: '7',
    };

    expect(
      findDrizzleJournalDiffValidationErrors('packages/api/drizzle/meta/_journal.json', baseJournal, headJournal),
    ).toEqual(['packages/api/drizzle/meta/_journal.json: pull requests must not remove existing journal entries.']);
  });
});
