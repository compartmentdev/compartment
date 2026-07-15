import { describe, expect, it } from 'vitest';
import { readRequiredAbsolutePath } from '../src/file-system-path';

describe('file system path helpers', (): void => {
  it('returns absolute paths', (): void => {
    expect(readRequiredAbsolutePath('/var/lib/compartment/data', 'CONFIG_PATH')).toBe('/var/lib/compartment/data');
  });

  it('rejects relative paths with the owning variable name', (): void => {
    expect((): string => {
      return readRequiredAbsolutePath('.compartment/data', 'CONFIG_PATH');
    }).toThrow('CONFIG_PATH must be an absolute path.');
  });
});
