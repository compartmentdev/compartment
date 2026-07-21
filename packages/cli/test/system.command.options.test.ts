import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CliBuildInfo } from '../src/cli-build-info.types';
import {
  resolveKubernetesSystemUpdateVersion,
  resolveSystemDomainVersionedCommand,
} from '../src/commands/system/system.command.options';

type ReadCliBuildInfo = () => CliBuildInfo;

interface SystemCommandOptionsMocks {
  readCliBuildInfo: Mock<ReadCliBuildInfo>;
}

const mocks: SystemCommandOptionsMocks = vi.hoisted(
  (): SystemCommandOptionsMocks => ({ readCliBuildInfo: vi.fn<ReadCliBuildInfo>() }),
);

vi.mock('../src/cli-build-info', (): object => ({ readCliBuildInfo: mocks.readCliBuildInfo }));

describe('system command options', (): void => {
  beforeEach((): void => {
    mocks.readCliBuildInfo.mockReset();
    mocks.readCliBuildInfo.mockReturnValue({ cliVersion: '0.9.2', distributionChannel: 'source' });
  });

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
    const shaTag: string = `sha-${'a'.repeat(40)}`;
    expect(resolveKubernetesSystemUpdateVersion(shaTag)).toBe(shaTag);
    expect((): string => resolveKubernetesSystemUpdateVersion(undefined)).toThrow(
      '--version is required when system update runs from a source CLI build.',
    );
    expect((): string => resolveKubernetesSystemUpdateVersion('invalid/tag')).toThrow(
      '--version must be a valid platform image tag.',
    );
  });

  it('selects the immutable main build tag for packaged main updates', (): void => {
    mocks.readCliBuildInfo.mockReturnValue({
      buildCommitSha: '1234567890abcdef1234567890abcdef12345678',
      cliVersion: '0.9.2',
      distributionChannel: 'main',
    });

    expect(resolveKubernetesSystemUpdateVersion(undefined)).toBe('sha-1234567890abcdef1234567890abcdef12345678');
  });

  it('selects the immutable kubernetes build tag for packaged kubernetes updates', (): void => {
    mocks.readCliBuildInfo.mockReturnValue({
      buildCommitSha: '1234567890abcdef1234567890abcdef12345678',
      cliVersion: '0.9.2',
      distributionChannel: 'kubernetes',
    });

    expect(resolveKubernetesSystemUpdateVersion(undefined)).toBe('sha-1234567890abcdef1234567890abcdef12345678');
  });

  it('selects the CLI version for packaged release updates', (): void => {
    mocks.readCliBuildInfo.mockReturnValue({ cliVersion: '0.9.2', distributionChannel: 'release' });

    expect(resolveKubernetesSystemUpdateVersion(undefined)).toBe('0.9.2');
  });
});
