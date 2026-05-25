import { describe, expect, it } from 'vitest';

import { hasText, readNonEmptyLines, slugifyText } from '../src';
import { isValidEmailAddress } from '../src/text';

describe('text helpers', (): void => {
  it('detects non-empty text', (): void => {
    expect(hasText(undefined)).toBe(false);
    expect(hasText('')).toBe(false);
    expect(hasText(' ')).toBe(false);
    expect(hasText('compartment')).toBe(true);
  });

  it('slugifies primitive text values', (): void => {
    expect(slugifyText('Backoffice App')).toBe('backoffice-app');
    expect(slugifyText('  Team/API  ')).toBe('team-api');
    expect(slugifyText('---')).toBe('');
    expect(slugifyText('---Team/API---')).toBe('team-api');
  });

  it('validates email addresses without regex backtracking', (): void => {
    expect(isValidEmailAddress('admin@acme.dev')).toBe(true);
    expect(isValidEmailAddress('team+ops@acme.dev')).toBe(true);
    expect(isValidEmailAddress('admin')).toBe(false);
    expect(isValidEmailAddress('admin@@acme.dev')).toBe(false);
    expect(isValidEmailAddress('admin@acme')).toBe(false);
    expect(isValidEmailAddress('admin@.dev')).toBe(false);
    expect(isValidEmailAddress('admin@acme.dev ')).toBe(false);
  });

  it('reads non-empty lines from text output', (): void => {
    expect(readNonEmptyLines('alpha\n\nbeta\n')).toEqual(['alpha', 'beta']);
    expect(readNonEmptyLines('alpha\r\n\r\nbeta\r\n')).toEqual(['alpha', 'beta']);
    expect(readNonEmptyLines('alpha\r\rbeta\r')).toEqual(['alpha', 'beta']);
    expect(readNonEmptyLines(' alpha \r\n   \r\nbeta\r')).toEqual([' alpha ', '   ', 'beta']);
  });
});
