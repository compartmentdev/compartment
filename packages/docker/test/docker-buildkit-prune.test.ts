import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type * as BuildkitCommandModule from '../src/buildkit-command';
import { pruneBuildKitCache } from '../src/docker-buildkit-prune';
import type { DockerCommandResult } from '../src/docker-command.types';
import type { DockerRegistryCredentials } from '../src/docker-models';

type RunBuildctlCommandWithRegistryRetry = (
  args: string[],
  registryCredentials?: DockerRegistryCredentials,
) => Promise<DockerCommandResult>;

const runBuildctlCommandWithRegistryRetry: Mock<RunBuildctlCommandWithRegistryRetry> = vi.hoisted(
  (): Mock<RunBuildctlCommandWithRegistryRetry> => vi.fn<RunBuildctlCommandWithRegistryRetry>(),
);

vi.mock(
  '../src/buildkit-command',
  async (importOriginal: () => Promise<typeof BuildkitCommandModule>): Promise<typeof BuildkitCommandModule> => {
    const actual: typeof BuildkitCommandModule = await importOriginal();

    return {
      ...actual,
      runBuildctlCommandWithRegistryRetry,
    };
  },
);

beforeEach((): void => {
  process.env.BUILDKIT_ADDR = 'tcp://builder:1234';
  runBuildctlCommandWithRegistryRetry.mockReset();
  runBuildctlCommandWithRegistryRetry.mockResolvedValue({ stderr: '', stdout: '' });
});

afterEach((): void => {
  delete process.env.BUILDKIT_ADDR;
});

describe('pruneBuildKitCache', (): void => {
  it('applies the fixed remote BuildKit cache retention policy', async (): Promise<void> => {
    await expect(pruneBuildKitCache()).resolves.toBeUndefined();

    expect(runBuildctlCommandWithRegistryRetry).toHaveBeenCalledWith([
      '--addr',
      'tcp://builder:1234',
      'prune',
      '--all',
      '--keep-duration',
      '24h',
      '--keep-storage',
      '2000',
    ]);
  });

  it('fails before invoking buildctl when the remote address is missing', async (): Promise<void> => {
    delete process.env.BUILDKIT_ADDR;

    await expect(pruneBuildKitCache()).rejects.toThrow('BUILDKIT_ADDR is required for remote BuildKit cache pruning.');
    expect(runBuildctlCommandWithRegistryRetry).not.toHaveBeenCalled();
  });
});
