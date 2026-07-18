import { describe, expect, it } from 'vitest';
import { resolveSystemDomainVersionedCommand } from '../src/commands/system/system.command.options';

describe('system command options', (): void => {
  it('accepts setup versions supported by the persisted integer contract', (): void => {
    expect(resolveSystemDomainVersionedCommand({ expectedVersion: '0', output: 'text' }).expectedSetupVersion).toBe(0);
    expect(
      resolveSystemDomainVersionedCommand({ expectedVersion: '2147483647', output: 'text' }).expectedSetupVersion,
    ).toBe(2_147_483_647);
  });

  it.each(['-1', '1.5', '2147483648', '9007199254740993', '9'.repeat(400)])(
    'rejects an out-of-contract setup version: %s',
    (expectedVersion: string): void => {
      expect((): void => {
        resolveSystemDomainVersionedCommand({ expectedVersion, output: 'text' });
      }).toThrow('Expected --expected-version to be a non-negative integer.');
    },
  );
});
