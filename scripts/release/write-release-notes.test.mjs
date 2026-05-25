import { describe, expect, it } from 'vitest';

import { readReleaseNotes } from './write-release-notes.mjs';

describe('write-release-notes', () => {
  it('extracts the matching changelog section', () => {
    expect(
      readReleaseNotes({
        releaseVersion: '0.2.0',
        changelogText: `# Changelog

## [0.2.0](https://github.com/compartmentdev/compartment/compare/v0.1.0...v0.2.0) (2026-05-25)

### Features

* add release automation

## [0.1.0](https://github.com/compartmentdev/compartment/releases/tag/v0.1.0) (2026-05-01)

### Features

* first release
`,
      }),
    ).toBe(`### Features

* add release automation
`);
  });

  it('supports plain version headings', () => {
    expect(
      readReleaseNotes({
        releaseVersion: '0.2.0',
        changelogText: `# Changelog

## 0.2.0

* release notes
`,
      }),
    ).toBe(`* release notes
`);
  });

  it('fails when the release notes are missing', () => {
    expect(() =>
      readReleaseNotes({
        releaseVersion: '0.3.0',
        changelogText: `# Changelog

## 0.2.0

* release notes
`,
      }),
    ).toThrow('Expected CHANGELOG.md to contain release notes for 0.3.0.');
  });

  it('uses fallback notes when the changelog section is missing', () => {
    expect(
      readReleaseNotes({
        fallbackNotes: 'Manual compartment release 0.3.0.',
        releaseVersion: '0.3.0',
        changelogText: `# Changelog

## 0.2.0

* release notes
`,
      }),
    ).toBe(`Manual compartment release 0.3.0.
`);
  });
});
