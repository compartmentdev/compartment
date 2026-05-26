import { describe, expect, it } from 'vitest';
import { readRequiredAbsolutePath } from '../src/file-system-path';

describe('file system path helpers', (): void => {
  it('returns absolute paths', (): void => {
    expect(readRequiredAbsolutePath('/var/lib/compartment/resource-backups', 'COMPARTMENT_RESOURCE_BACKUP_DIR')).toBe(
      '/var/lib/compartment/resource-backups',
    );
  });

  it('rejects relative paths with the owning variable name', (): void => {
    expect((): string => {
      return readRequiredAbsolutePath('.compartment/resource-backups', 'COMPARTMENT_RESOURCE_BACKUP_DIR');
    }).toThrow('COMPARTMENT_RESOURCE_BACKUP_DIR must be an absolute path.');
  });
});
