import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCommandWithTransientBuildRetry } from '../src/build-command-retry';
import type { DockerCommandResult } from '../src/docker-command.types';

interface TimerPromisesMock {
  setTimeout: (milliseconds?: number) => Promise<void>;
}

vi.mock(
  'node:timers/promises',
  (): TimerPromisesMock => ({
    setTimeout: vi.fn(async (): Promise<void> => {
      await Promise.resolve();
    }),
  }),
);

afterEach((): void => {
  vi.clearAllMocks();
});

describe('build command retry', (): void => {
  it('retries a transient BuildKit connection refusal before succeeding', async (): Promise<void> => {
    const command: () => Promise<DockerCommandResult> = vi
      .fn<() => Promise<{ stderr: string; stdout: string }>>()
      .mockRejectedValueOnce(
        Object.assign(new Error('buildctl failed'), {
          stderr:
            'rpc error: code = Unavailable desc = connection error: desc = "transport: Error while dialing: dial tcp 10.43.0.8:1234: connect: connection refused"',
        }),
      )
      .mockResolvedValue({ stderr: '', stdout: 'ready' });

    const resultPromise: Promise<DockerCommandResult> = runCommandWithTransientBuildRetry(
      command,
      'tcp://compartment-buildkit.platform-build.svc:1234',
    );

    await expect(resultPromise).resolves.toEqual({ stderr: '', stdout: 'ready' });
    expect(command).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledWith(500);
  });

  it.each([
    'buildctl failed: invalid Dockerfile syntax',
    'buildkit build failed: denied: requested access to the resource is denied',
    'buildctl failed: failed to solve: executor failed running with exit code 1',
  ])('does not retry a product build failure: %s', async (message: string): Promise<void> => {
    const productFailure: Error = new Error(message);
    const command: () => Promise<DockerCommandResult> = vi.fn().mockRejectedValue(productFailure);

    await expect(runCommandWithTransientBuildRetry(command, 'tcp://buildkit:1234')).rejects.toBe(productFailure);
    expect(command).toHaveBeenCalledOnce();
  });

  it('does not retry a product build failure', async (): Promise<void> => {
    const productFailure: Error = new Error('buildctl failed: invalid Dockerfile syntax');
    const command: () => Promise<DockerCommandResult> = vi.fn().mockRejectedValue(productFailure);

    await expect(runCommandWithTransientBuildRetry(command)).rejects.toBe(productFailure);
    expect(command).toHaveBeenCalledOnce();
  });

  it('does not retry an application connection refusal reported by a build step', async (): Promise<void> => {
    const productFailure: Error = Object.assign(new Error('Command failed with exit code 1: buildctl build'), {
      stderr: '#7 RUN curl http://127.0.0.1:8080\ncurl: (7) Failed to connect: Connection refused',
    });
    const command: () => Promise<DockerCommandResult> = vi.fn().mockRejectedValue(productFailure);

    await expect(runCommandWithTransientBuildRetry(command)).rejects.toBe(productFailure);
    expect(command).toHaveBeenCalledOnce();
  });

  it('does not retry a nested gRPC refusal for a different endpoint', async (): Promise<void> => {
    const productFailure: Error = Object.assign(new Error('buildctl failed'), {
      stderr:
        'rpc error: code = Unavailable desc = connection error: desc = "transport: Error while dialing: dial tcp 10.43.0.9:8443: connect: connection refused"',
    });
    const command: () => Promise<DockerCommandResult> = vi.fn().mockRejectedValue(productFailure);

    await expect(
      runCommandWithTransientBuildRetry(command, 'tcp://compartment-buildkit.platform-build.svc:1234'),
    ).rejects.toBe(productFailure);
    expect(command).toHaveBeenCalledOnce();
  });

  it('preserves the bounded Docker Hub token retry contract', async (): Promise<void> => {
    const registryFailure: Error = Object.assign(new Error('buildctl failed'), {
      stderr:
        'failed to fetch oauth token: unexpected status from POST request to https://auth.docker.io/token: 500 Internal Server Error',
    });
    const command: () => Promise<DockerCommandResult> = vi.fn().mockRejectedValue(registryFailure);

    await expect(runCommandWithTransientBuildRetry(command)).rejects.toBe(registryFailure);
    expect(command).toHaveBeenCalledTimes(3);
    expect(delay).toHaveBeenNthCalledWith(1, 1_000);
    expect(delay).toHaveBeenNthCalledWith(2, 1_000);
  });

  it('exhausts the bounded BuildKit dial retry and preserves the final error', async (): Promise<void> => {
    const buildKitFailure: Error = Object.assign(new Error('buildctl failed'), {
      stderr:
        'rpc error: code = Unavailable desc = connection error: desc = "transport: Error while dialing: dial tcp 10.43.0.8:1234: connect: connection refused"',
    });
    const command: () => Promise<DockerCommandResult> = vi.fn().mockRejectedValue(buildKitFailure);

    await expect(
      runCommandWithTransientBuildRetry(command, 'tcp://compartment-buildkit.platform-build.svc:1234'),
    ).rejects.toBe(buildKitFailure);
    expect(command).toHaveBeenCalledTimes(6);
    expect(delay).toHaveBeenNthCalledWith(1, 500);
    expect(delay).toHaveBeenNthCalledWith(2, 1_000);
    expect(delay).toHaveBeenNthCalledWith(3, 2_000);
    expect(delay).toHaveBeenNthCalledWith(4, 4_000);
    expect(delay).toHaveBeenNthCalledWith(5, 8_000);
  });
});
