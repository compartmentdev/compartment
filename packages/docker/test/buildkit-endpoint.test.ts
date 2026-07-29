import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectBuildKitEndpoint } from '../src/buildkit-endpoint-adapter';
import { readBuildKitAddressFromArgs, waitForBuildKitEndpoint } from '../src/buildkit-endpoint';

interface TimerPromisesMock {
  setTimeout: (milliseconds?: number) => Promise<void>;
}
interface BuildKitEndpointAdapterMock {
  connectBuildKitEndpoint: (hostname: string, port: number) => Promise<void>;
}

vi.mock(
  'node:timers/promises',
  (): TimerPromisesMock => ({
    setTimeout: vi.fn(async (): Promise<void> => {
      await Promise.resolve();
    }),
  }),
);
vi.mock(
  '../src/buildkit-endpoint-adapter',
  (): BuildKitEndpointAdapterMock => ({
    connectBuildKitEndpoint: vi.fn(async (): Promise<void> => {
      await Promise.resolve();
    }),
  }),
);

afterEach((): void => {
  vi.clearAllMocks();
});

describe('BuildKit endpoint readiness', (): void => {
  it('waits for a refused endpoint before reporting readiness', async (): Promise<void> => {
    const refusal: NodeJS.ErrnoException = new Error('connect ECONNREFUSED');
    refusal.code = 'ECONNREFUSED';
    vi.mocked(connectBuildKitEndpoint).mockRejectedValueOnce(refusal).mockResolvedValue();

    await waitForBuildKitEndpoint('tcp://compartment-buildkit.platform-build.svc:1234');

    expect(connectBuildKitEndpoint).toHaveBeenCalledTimes(2);
    expect(connectBuildKitEndpoint).toHaveBeenCalledWith('compartment-buildkit.platform-build.svc', 1234);
    expect(delay).toHaveBeenCalledWith(250);
  });

  it('fails immediately for a non-transient endpoint error', async (): Promise<void> => {
    const invalidEndpoint: NodeJS.ErrnoException = new Error('getaddrinfo ENOTFOUND invalid');
    invalidEndpoint.code = 'ENOTFOUND';
    vi.mocked(connectBuildKitEndpoint).mockRejectedValue(invalidEndpoint);

    await expect(waitForBuildKitEndpoint('tcp://invalid.example:1234')).rejects.toBe(invalidEndpoint);
    expect(connectBuildKitEndpoint).toHaveBeenCalledOnce();
    expect(delay).not.toHaveBeenCalled();
  });

  it('retries endpoint timeouts and caps the delay before succeeding', async (): Promise<void> => {
    const timeout: NodeJS.ErrnoException = new Error('connect ETIMEDOUT');
    timeout.code = 'ETIMEDOUT';
    vi.mocked(connectBuildKitEndpoint)
      .mockRejectedValueOnce(timeout)
      .mockRejectedValueOnce(timeout)
      .mockRejectedValueOnce(timeout)
      .mockRejectedValueOnce(timeout)
      .mockRejectedValueOnce(timeout)
      .mockResolvedValue();

    await waitForBuildKitEndpoint('tcp://buildkit:1234');

    expect(delay).toHaveBeenNthCalledWith(1, 250);
    expect(delay).toHaveBeenNthCalledWith(2, 500);
    expect(delay).toHaveBeenNthCalledWith(3, 1_000);
    expect(delay).toHaveBeenNthCalledWith(4, 2_000);
    expect(delay).toHaveBeenNthCalledWith(5, 2_000);
  });

  it('exhausts the bounded readiness attempts and preserves the endpoint error', async (): Promise<void> => {
    const refusal: NodeJS.ErrnoException = new Error('connect ECONNREFUSED');
    refusal.code = 'ECONNREFUSED';
    vi.mocked(connectBuildKitEndpoint).mockRejectedValue(refusal);

    await expect(waitForBuildKitEndpoint('tcp://buildkit:1234')).rejects.toBe(refusal);
    expect(connectBuildKitEndpoint).toHaveBeenCalledTimes(20);
    expect(delay).toHaveBeenCalledTimes(19);
    expect(delay).toHaveBeenLastCalledWith(2_000);
  });

  it('reads the canonical TCP endpoint from buildctl arguments', (): void => {
    expect(readBuildKitAddressFromArgs(['--addr', 'tcp://buildkit:1234', 'build'])).toBe('tcp://buildkit:1234');
    expect(readBuildKitAddressFromArgs(['build'])).toBeNull();
  });
});
