import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  runBuildctlCommandWithOptionalProgressReporter,
  runBuildctlCommandWithRegistryRetry,
} from '../src/buildkit-command';
import { waitForBuildKitEndpoint } from '../src/buildkit-endpoint';
import { runProcessCommand, runProcessCommandWithProgress } from '../src/process-command';

interface BuildKitEndpointMock {
  readBuildKitAddressFromArgs: (args: readonly string[]) => string | null;
  waitForBuildKitEndpoint: (address: string) => Promise<void>;
}

interface ProcessCommandMock {
  runProcessCommand: () => Promise<{ stderr: string; stdout: string }>;
  runProcessCommandWithProgress: () => Promise<{ stderr: string; stdout: string }>;
}

type ImportOriginalBuildKitEndpoint = () => Promise<BuildKitEndpointMock>;

vi.mock(
  '../src/buildkit-endpoint',
  async (importOriginal: ImportOriginalBuildKitEndpoint): Promise<BuildKitEndpointMock> => {
    const original: BuildKitEndpointMock = await importOriginal();
    return {
      ...original,
      waitForBuildKitEndpoint: vi.fn(async (): Promise<void> => {
        await Promise.resolve();
      }),
    };
  },
);

vi.mock(
  '../src/process-command',
  (): ProcessCommandMock => ({
    runProcessCommand: vi.fn(
      async (): Promise<{ stderr: string; stdout: string }> => await Promise.resolve({ stderr: '', stdout: '' }),
    ),
    runProcessCommandWithProgress: vi.fn(
      async (): Promise<{ stderr: string; stdout: string }> => await Promise.resolve({ stderr: '', stdout: '' }),
    ),
  }),
);

afterEach((): void => {
  vi.clearAllMocks();
});

describe('BuildKit command readiness boundary', (): void => {
  it('waits for the configured endpoint before starting buildctl', async (): Promise<void> => {
    const args: string[] = ['--addr', 'tcp://compartment-buildkit.platform-build.svc:1234', 'build'];

    await runBuildctlCommandWithRegistryRetry(args);

    expect(waitForBuildKitEndpoint).toHaveBeenCalledWith('tcp://compartment-buildkit.platform-build.svc:1234');
    expect(runProcessCommand).toHaveBeenCalledOnce();
    expect(vi.mocked(waitForBuildKitEndpoint).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(runProcessCommand).mock.invocationCallOrder[0]!,
    );
  });

  it('applies the same readiness boundary to progress builds', async (): Promise<void> => {
    const args: string[] = ['--addr', 'tcp://buildkit:1234', 'build'];

    await runBuildctlCommandWithOptionalProgressReporter(args, async (): Promise<void> => {
      await Promise.resolve();
    });

    expect(waitForBuildKitEndpoint).toHaveBeenCalledWith('tcp://buildkit:1234');
    expect(runProcessCommandWithProgress).toHaveBeenCalledOnce();
    expect(vi.mocked(waitForBuildKitEndpoint).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(runProcessCommandWithProgress).mock.invocationCallOrder[0]!,
    );
  });

  it('does not start buildctl when endpoint readiness fails', async (): Promise<void> => {
    const readinessFailure: Error = new Error('BuildKit endpoint is unavailable.');
    vi.mocked(waitForBuildKitEndpoint).mockRejectedValue(readinessFailure);

    await expect(runBuildctlCommandWithRegistryRetry(['--addr', 'tcp://buildkit:1234', 'build'])).rejects.toBe(
      readinessFailure,
    );
    expect(runProcessCommand).not.toHaveBeenCalled();
  });
});
