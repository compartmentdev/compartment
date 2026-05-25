import { describe, expect, it } from 'vitest';
import { assertEmail, validateInstallEmail, validateLoginEmail } from '../src/prompts/prompt.validation';

describe('prompt validation', (): void => {
  it('accepts valid email addresses without regex backtracking', (): void => {
    expect(validateInstallEmail('admin@acme.dev')).toBeUndefined();
    expect(validateLoginEmail('team+ops@acme.dev')).toBeUndefined();
  });

  it('rejects malformed email addresses', (): void => {
    expect(validateInstallEmail('admin')).toBe('Email must be a valid address.');
    expect(validateInstallEmail('admin@@acme.dev')).toBe('Email must be a valid address.');
    expect(validateInstallEmail('admin@acme')).toBe('Email must be a valid address.');
    expect(validateInstallEmail('admin@.dev')).toBe('Email must be a valid address.');
    expect(validateInstallEmail('admin@acme.dev ')).toBe('Email must be a valid address.');
  });

  it('throws for invalid asserted email addresses', (): void => {
    expect((): void => assertEmail('admin@acme')).toThrowError('Email must be a valid address.');
  });
});
