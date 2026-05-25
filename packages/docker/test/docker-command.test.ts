import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ExecFileOptions } from 'node:child_process';
import { runDockerCommand, runDockerCommandWithRegistryRetry } from '../src/docker-command';

type Delay = (milliseconds?: number) => Promise<void>;
type ExecuteFileAsync = (
  file: string,
  args: readonly string[],
  options?: ExecFileOptions,
) => Promise<{ stderr: string; stdout: string }>;
type Promisify = () => Mock<ExecuteFileAsync>;

interface DockerCommandTestMocks {
  delay: Mock<Delay>;
  executeFileAsync: Mock<ExecuteFileAsync>;
}

const mocks: DockerCommandTestMocks = vi.hoisted(
  (): DockerCommandTestMocks => ({
    delay: vi.fn<Delay>().mockResolvedValue(undefined),
    executeFileAsync: vi.fn<ExecuteFileAsync>(),
  }),
);

vi.mock('node:child_process', (): { execFile: Mock<() => void> } => ({
  execFile: vi.fn(),
}));

vi.mock('node:timers/promises', (): { setTimeout: Mock<Delay> } => ({
  setTimeout: mocks.delay,
}));

vi.mock('node:util', (): { promisify: Mock<Promisify> } => ({
  promisify: vi.fn<Promisify>((): Mock<ExecuteFileAsync> => mocks.executeFileAsync),
}));

afterEach((): void => {
  mocks.delay.mockClear();
  mocks.executeFileAsync.mockReset();
});

describe('runDockerCommand', (): void => {
  it('executes docker with the provided argv', async (): Promise<void> => {
    mocks.executeFileAsync.mockResolvedValueOnce({
      stderr: '',
      stdout: 'sha256:image-id\n',
    });

    await expect(runDockerCommand(['image', 'inspect', 'compartment-test:railpack'])).resolves.toEqual({
      stderr: '',
      stdout: 'sha256:image-id\n',
    });

    expect(mocks.executeFileAsync.mock.calls[0]?.[0]).toBe('docker');
    expect(mocks.executeFileAsync.mock.calls[0]?.[1]).toEqual(['image', 'inspect', 'compartment-test:railpack']);
    expect(mocks.executeFileAsync.mock.calls[0]?.[2]?.env).toBeDefined();
  });
});

describe('runDockerCommandWithRegistryRetry', (): void => {
  it('retries transient Docker Hub oauth token failures', async (): Promise<void> => {
    const error: Error & { stderr?: string | undefined } = new Error(
      'failed to solve: failed to fetch oauth token: unexpected status from POST request to https://auth.docker.io/token: 500 Internal Server Error',
    );

    error.stderr =
      'failed to authorize: failed to fetch oauth token: unexpected status from POST request to https://auth.docker.io/token: 500 Internal Server Error';

    mocks.executeFileAsync.mockRejectedValueOnce(error).mockResolvedValueOnce({
      stderr: '',
      stdout: 'sha256:image-id\n',
    });

    await expect(
      runDockerCommandWithRegistryRetry(['build', '-t', 'compartment-test', '/tmp/service']),
    ).resolves.toEqual({
      stderr: '',
      stdout: 'sha256:image-id\n',
    });

    expect(mocks.executeFileAsync).toHaveBeenCalledTimes(2);
    expect(mocks.delay).toHaveBeenCalledWith(1_000);
  });

  it('fails fast on non-transient docker command errors', async (): Promise<void> => {
    mocks.executeFileAsync.mockRejectedValueOnce(new Error('No such image'));

    await expect(
      runDockerCommandWithRegistryRetry(['build', '-t', 'compartment-test', '/tmp/service']),
    ).rejects.toThrow('No such image');

    expect(mocks.executeFileAsync).toHaveBeenCalledTimes(1);
    expect(mocks.delay).not.toHaveBeenCalled();
  });

  it('fails fast when the Docker Hub auth URL only appears inside another URL', async (): Promise<void> => {
    const error: Error & { stderr?: string | undefined } = new Error(
      'failed to fetch oauth token from https://mirror.example/https://auth.docker.io/token: 500 Internal Server Error',
    );
    error.stderr = error.message;

    mocks.executeFileAsync.mockRejectedValueOnce(error);

    await expect(
      runDockerCommandWithRegistryRetry(['build', '-t', 'compartment-test', '/tmp/service']),
    ).rejects.toThrow('failed to fetch oauth token');

    expect(mocks.executeFileAsync).toHaveBeenCalledTimes(1);
    expect(mocks.delay).not.toHaveBeenCalled();
  });
});
