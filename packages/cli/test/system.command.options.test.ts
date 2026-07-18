import { describe, expect, it } from 'vitest';
import {
  resolveKubernetesSystemUpdateVersion,
  resolveSystemDomainVersionedCommand,
} from '../src/commands/system/system.command.options';

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
      }).toThrow('Expected --expected-version to be an integer from 0 to 2147483647.');
    },
  );

  it('requires an explicit image tag for source-build updates', (): void => {
    expect(resolveKubernetesSystemUpdateVersion('sha-release')).toBe('sha-release');
    expect((): string => resolveKubernetesSystemUpdateVersion(undefined)).toThrow(
      '--version is required when system update runs from a source CLI build.',
    );
    expect((): string => resolveKubernetesSystemUpdateVersion('invalid/tag')).toThrow(
      '--version must be a valid platform image tag.',
    );
  });
});
