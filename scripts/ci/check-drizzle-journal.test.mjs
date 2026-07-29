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
  it('allows only the one-time Kubernetes acceptance resquash', () => {
    expect(
      findDrizzleJournalDiffValidationErrors(
        'packages/api/drizzle/meta/_journal.json',
        buildKubernetesAcceptanceResquashBaseJournal(),
        buildKubernetesAcceptanceResquashHeadJournal(),
      ),
    ).toEqual([]);
  });

  it.each([
    ['another package journal', 'packages/audit/drizzle/meta/_journal.json', () => {}, () => {}],
    [
      'changed base migration',
      'packages/api/drizzle/meta/_journal.json',
      (journal) => (journal.entries[5].tag = '0005_other'),
      () => {},
    ],
    [
      'changed head timestamp',
      'packages/api/drizzle/meta/_journal.json',
      () => {},
      (journal) => (journal.entries[0].when += 1),
    ],
    [
      'retained a transitional entry',
      'packages/api/drizzle/meta/_journal.json',
      () => {},
      (journal) =>
        journal.entries.push({ breakpoints: true, idx: 1, tag: '0001_extra', version: '7', when: 1785301596024 }),
    ],
  ])('rejects the Kubernetes acceptance resquash exemption for %s', (_name, journalPath, mutateBase, mutateHead) => {
    const baseJournal = buildKubernetesAcceptanceResquashBaseJournal();
    const headJournal = buildKubernetesAcceptanceResquashHeadJournal();
    mutateBase(baseJournal);
    mutateHead(headJournal);

    expect(findDrizzleJournalDiffValidationErrors(journalPath, baseJournal, headJournal)).not.toEqual([]);
  });

  it('allows only the one-time Kubernetes retention resquash', () => {
    expect(
      findDrizzleJournalDiffValidationErrors(
        'packages/api/drizzle/meta/_journal.json',
        buildKubernetesRetentionResquashBaseJournal(),
        buildKubernetesRetentionResquashHeadJournal(),
      ),
    ).toEqual([]);
  });

  it.each([
    ['another package journal', 'packages/audit/drizzle/meta/_journal.json', () => {}, () => {}],
    [
      'changed base 0000 timestamp',
      'packages/api/drizzle/meta/_journal.json',
      (journal) => (journal.entries[0].when -= 1),
      () => {},
    ],
    [
      'changed base 0001 tag',
      'packages/api/drizzle/meta/_journal.json',
      (journal) => (journal.entries[1].tag = '0001_other'),
      () => {},
    ],
    [
      'changed surviving 0000 entry',
      'packages/api/drizzle/meta/_journal.json',
      () => {},
      (journal) => (journal.entries[0].breakpoints = false),
    ],
    [
      'removed every head entry',
      'packages/api/drizzle/meta/_journal.json',
      () => {},
      (journal) => (journal.entries = []),
    ],
    [
      'extra different head entry',
      'packages/api/drizzle/meta/_journal.json',
      () => {},
      (journal) =>
        journal.entries.push({ breakpoints: true, idx: 2, tag: '0002_extra', version: '7', when: 1784734906422 }),
    ],
    [
      'changed head dialect',
      'packages/api/drizzle/meta/_journal.json',
      () => {},
      (journal) => (journal.dialect = 'sqlite'),
    ],
    ['changed base version', 'packages/api/drizzle/meta/_journal.json', (journal) => (journal.version = '8'), () => {}],
    ['added a head field', 'packages/api/drizzle/meta/_journal.json', () => {}, (journal) => (journal.extra = true)],
  ])('rejects the Kubernetes retention resquash exemption for %s', (_name, journalPath, mutateBase, mutateHead) => {
    const baseJournal = buildKubernetesRetentionResquashBaseJournal();
    const headJournal = buildKubernetesRetentionResquashHeadJournal();
    mutateBase(baseJournal);
    mutateHead(headJournal);

    expect(findDrizzleJournalDiffValidationErrors(journalPath, baseJournal, headJournal)).not.toEqual([]);
  });

  it('allows only the D16 regenerated baseline timestamp change', () => {
    expect(
      findDrizzleJournalDiffValidationErrors(
        'packages/api/drizzle/meta/_journal.json',
        buildD16BaseJournal(),
        buildD16HeadJournal(),
      ),
    ).toEqual([]);
  });

  it.each([
    ['another package journal', 'packages/audit/drizzle/meta/_journal.json', () => {}, () => {}],
    [
      'another base timestamp',
      'packages/api/drizzle/meta/_journal.json',
      (journal) => (journal.entries[0].when = 1779700755037),
      () => {},
    ],
    [
      'another head timestamp',
      'packages/api/drizzle/meta/_journal.json',
      () => {},
      (journal) => (journal.entries[0].when = 1783948017383),
    ],
  ])('rejects the D16 exemption for %s', (_name, journalPath, mutateBaseJournal, mutateHeadJournal) => {
    const baseJournal = buildD16BaseJournal();
    const headJournal = buildD16HeadJournal();
    mutateBaseJournal(baseJournal);
    mutateHeadJournal(headJournal);

    expect(findDrizzleJournalDiffValidationErrors(journalPath, baseJournal, headJournal)).not.toEqual([]);
  });

  it.each([
    ['changed tag', (journal) => (journal.entries[0].tag = '0000_rewritten')],
    ['changed idx', (journal) => (journal.entries[0].idx = 1)],
    ['removed entry', (journal) => (journal.entries = [])],
    [
      'appended entry',
      (journal) =>
        journal.entries.push({ breakpoints: true, idx: 1, tag: '0001_extra', version: '7', when: 1783948017383 }),
    ],
    ['changed dialect', (journal) => (journal.dialect = 'sqlite')],
    ['changed entry version', (journal) => (journal.entries[0].version = '8')],
    ['changed breakpoints', (journal) => (journal.entries[0].breakpoints = false)],
    ['changed journal version', (journal) => (journal.version = '8')],
    ['added journal field', (journal) => (journal.extra = true)],
    ['added entry field', (journal) => (journal.entries[0].extra = true)],
  ])('rejects the D16 exemption with a %s', (_name, mutateHeadJournal) => {
    const headJournal = buildD16HeadJournal();
    mutateHeadJournal(headJournal);

    expect(
      findDrizzleJournalDiffValidationErrors(
        'packages/api/drizzle/meta/_journal.json',
        buildD16BaseJournal(),
        headJournal,
      ),
    ).not.toEqual([]);
  });

  it('rejects reordering existing same-length journal history', () => {
    const firstEntry = { breakpoints: true, idx: 0, tag: '0000_initial', version: '7', when: 1 };
    const secondEntry = { breakpoints: true, idx: 1, tag: '0001_next', version: '7', when: 2 };
    const baseJournal = { dialect: 'postgresql', entries: [firstEntry, secondEntry], version: '7' };
    const headJournal = { dialect: 'postgresql', entries: [secondEntry, firstEntry], version: '7' };

    expect(
      findDrizzleJournalDiffValidationErrors('packages/api/drizzle/meta/_journal.json', baseJournal, headJournal),
    ).not.toEqual([]);
  });

  it('allows the one-time docker cutover squash to a fresh 0000_initial', () => {
    const headJournal = {
      dialect: 'postgresql',
      entries: [{ breakpoints: true, idx: 0, tag: '0000_initial', version: '7', when: 1783934368213 }],
      version: '7',
    };

    expect(
      findDrizzleJournalDiffValidationErrors(
        'packages/api/drizzle/meta/_journal.json',
        buildDockerCutoverBaseJournal(),
        headJournal,
      ),
    ).toEqual([]);
  });

  it('rejects the docker cutover squash when the fresh entry is not newer than the base history', () => {
    const headJournal = {
      dialect: 'postgresql',
      entries: [{ breakpoints: true, idx: 0, tag: '0000_initial', version: '7', when: 1783934368212 }],
      version: '7',
    };

    expect(
      findDrizzleJournalDiffValidationErrors(
        'packages/api/drizzle/meta/_journal.json',
        buildDockerCutoverBaseJournal(),
        headJournal,
      ),
    ).toEqual(['packages/api/drizzle/meta/_journal.json: pull requests must not remove existing journal entries.']);
  });

  it('rejects the docker cutover squash for a journal outside packages/api', () => {
    const headJournal = {
      dialect: 'postgresql',
      entries: [{ breakpoints: true, idx: 0, tag: '0000_initial', version: '7', when: 1783934368213 }],
      version: '7',
    };

    expect(
      findDrizzleJournalDiffValidationErrors(
        'packages/audit/drizzle/meta/_journal.json',
        buildDockerCutoverBaseJournal(),
        headJournal,
      ),
    ).toEqual(['packages/audit/drizzle/meta/_journal.json: pull requests must not remove existing journal entries.']);
  });

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

function buildD16BaseJournal() {
  return buildD16Journal(1779700755038);
}

function buildKubernetesAcceptanceResquashBaseJournal() {
  return {
    dialect: 'postgresql',
    entries: [
      { breakpoints: true, idx: 0, tag: '0000_initial', version: '7', when: 1783948017382 },
      { breakpoints: true, idx: 1, tag: '0001_concerned_ben_urich', version: '7', when: 1784909278511 },
      { breakpoints: true, idx: 2, tag: '0002_thankful_krista_starr', version: '7', when: 1785223501177 },
      { breakpoints: true, idx: 3, tag: '0003_thick_gravity', version: '7', when: 1785239564368 },
      { breakpoints: true, idx: 4, tag: '0004_mixed_slyde', version: '7', when: 1785261363115 },
      { breakpoints: true, idx: 5, tag: '0005_bright_cardiac', version: '7', when: 1785281013566 },
    ],
    version: '7',
  };
}

function buildKubernetesAcceptanceResquashHeadJournal() {
  return {
    dialect: 'postgresql',
    entries: [{ breakpoints: true, idx: 0, tag: '0000_initial', version: '7', when: 1785301596023 }],
    version: '7',
  };
}

function buildKubernetesRetentionResquashBaseJournal() {
  return {
    dialect: 'postgresql',
    entries: [
      { breakpoints: true, idx: 0, tag: '0000_initial', version: '7', when: 1783948017382 },
      { breakpoints: true, idx: 1, tag: '0001_living_spirit', version: '7', when: 1784734906421 },
    ],
    version: '7',
  };
}

function buildKubernetesRetentionResquashHeadJournal() {
  return {
    dialect: 'postgresql',
    entries: [{ breakpoints: true, idx: 0, tag: '0000_initial', version: '7', when: 1783948017382 }],
    version: '7',
  };
}

function buildD16HeadJournal() {
  return buildD16Journal(1783948017382);
}

function buildD16Journal(when) {
  return {
    dialect: 'postgresql',
    entries: [{ breakpoints: true, idx: 0, tag: '0000_initial', version: '7', when }],
    version: '7',
  };
}

function buildDockerCutoverBaseJournal() {
  return {
    dialect: 'postgresql',
    entries: [
      { breakpoints: true, idx: 0, tag: '0000_initial', version: '7', when: 1779700755038 },
      { breakpoints: true, idx: 1, tag: '0001_even_ravenous', version: '7', when: 1783786185100 },
      { breakpoints: true, idx: 2, tag: '0002_tearful_yellow_claw', version: '7', when: 1783863046900 },
      { breakpoints: true, idx: 3, tag: '0003_polite_sir_ram', version: '7', when: 1783882325446 },
      { breakpoints: true, idx: 4, tag: '0004_greedy_overlord', version: '7', when: 1783934368212 },
    ],
    version: '7',
  };
}
