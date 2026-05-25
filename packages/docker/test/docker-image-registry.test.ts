import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { DockerCommandResult } from '../src/docker-command.types';
import { ensureDockerImageAvailable } from '../src/docker-image-registry';
import type { DockerRegistryCredentials } from '../src/docker-models';

type RunDockerCommand = (
  args: string[],
  registryCredentials?: DockerRegistryCredentials,
) => Promise<DockerCommandResult>;
type RunDockerCommandWithRegistryRetry = (
  args: string[],
  registryCredentials?: DockerRegistryCredentials,
) => Promise<DockerCommandResult>;

interface DockerImageRegistryTestMocks {
  runDockerCommand: Mock<RunDockerCommand>;
  runDockerCommandWithRegistryRetry: Mock<RunDockerCommandWithRegistryRetry>;
}

const mocks: DockerImageRegistryTestMocks = vi.hoisted(
  (): DockerImageRegistryTestMocks => ({
    runDockerCommand: vi.fn<RunDockerCommand>(),
    runDockerCommandWithRegistryRetry: vi.fn<RunDockerCommandWithRegistryRetry>(),
  }),
);

vi.mock(
  '../src/docker-command',
  (): {
    runDockerCommand: Mock<RunDockerCommand>;
    runDockerCommandWithRegistryRetry: Mock<RunDockerCommandWithRegistryRetry>;
  } => ({
    runDockerCommand: mocks.runDockerCommand,
    runDockerCommandWithRegistryRetry: mocks.runDockerCommandWithRegistryRetry,
  }),
);

afterEach((): void => {
  mocks.runDockerCommand.mockReset();
  mocks.runDockerCommandWithRegistryRetry.mockReset();
});

describe('ensureDockerImageAvailable', (): void => {
  it('uses an existing local runtime image without pulling', async (): Promise<void> => {
    mocks.runDockerCommand.mockResolvedValueOnce({ stderr: '', stdout: '{}' });

    await expect(ensureDockerImageAvailable({ imageRef: 'registry.example/app@sha256:abc' })).resolves.toBeUndefined();

    expect(mocks.runDockerCommandWithRegistryRetry).not.toHaveBeenCalled();
  });

  it('pulls a missing runtime image', async (): Promise<void> => {
    const error: Error & { stderr?: string | undefined } = new Error('docker image inspect failed');
    error.stderr = 'Error response from daemon: No such image: registry.example/app@sha256:abc';
    mocks.runDockerCommand.mockRejectedValueOnce(error);
    mocks.runDockerCommandWithRegistryRetry.mockResolvedValueOnce({ stderr: '', stdout: '' });

    await expect(ensureDockerImageAvailable({ imageRef: 'registry.example/app@sha256:abc' })).resolves.toBeUndefined();

    expect(mocks.runDockerCommandWithRegistryRetry).toHaveBeenCalledWith(
      ['pull', 'registry.example/app@sha256:abc'],
      undefined,
    );
  });
});
