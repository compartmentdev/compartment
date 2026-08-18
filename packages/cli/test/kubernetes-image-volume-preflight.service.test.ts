import { afterEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { runCommandWithInput, runCommandWithTimeout } from '../src/command-runner';
import type { CommandResult } from '../src/command-runner.types';
import {
  assertKubernetesImageVolumeCapability,
  verifyKubernetesImageVolumeRuntime,
} from '../src/services/kubernetes-image-volume-preflight.service';
import type { KubernetesImageVolumeCapabilityTarget } from '../src/services/kubernetes-image-volume-preflight.service.types';
import { readReadyKubernetesNodeNames } from '../src/services/kubernetes-ready-nodes.service';

vi.mock('../src/command-runner', (): object => ({ runCommandWithInput: vi.fn(), runCommandWithTimeout: vi.fn() }));
vi.mock('../src/services/kubernetes-ready-nodes.service', (): object => ({
  readReadyKubernetesNodeNames: vi.fn(async (): Promise<string[]> => await Promise.resolve(['build-a', 'build-b'])),
}));

const mockedRunCommandWithInput: MockedFunction<typeof runCommandWithInput> = vi.mocked(runCommandWithInput);
const mockedRunCommandWithTimeout: MockedFunction<typeof runCommandWithTimeout> = vi.mocked(runCommandWithTimeout);
const mockedReadReadyKubernetesNodeNames: MockedFunction<typeof readReadyKubernetesNodeNames> =
  vi.mocked(readReadyKubernetesNodeNames);

describe('Kubernetes ImageVolume capability preflight', (): void => {
  afterEach((): void => {
    vi.clearAllMocks();
    mockedReadReadyKubernetesNodeNames.mockResolvedValue(['build-a', 'build-b']);
  });

  it('mounts an image volume on every current eligible node and removes its canaries', async (): Promise<void> => {
    mockedRunCommandWithInput.mockResolvedValue(success(''));
    mockedRunCommandWithTimeout.mockResolvedValue(success(''));

    await expect(verifyKubernetesImageVolumeRuntime(target())).resolves.toBeUndefined();

    const manifests: string[] = mockedRunCommandWithInput.mock.calls.map((call): string => call[1]);
    expect(manifests).toHaveLength(2);
    expect(manifests.some((manifest): boolean => manifest.includes('"nodeName":"build-a"'))).toBe(true);
    expect(manifests.some((manifest): boolean => manifest.includes('"nodeName":"build-b"'))).toBe(true);
    expect(mockedRunCommandWithTimeout.mock.calls.filter((call): boolean => call[0].includes('exec'))).toHaveLength(2);
    expect(mockedRunCommandWithTimeout.mock.calls.filter((call): boolean => call[0].includes('delete'))).toHaveLength(
      2,
    );
  });

  it('fails closed and removes the canary when an eligible kubelet cannot mount the image volume', async (): Promise<void> => {
    mockedReadReadyKubernetesNodeNames.mockResolvedValue(['build-a']);
    mockedRunCommandWithInput.mockResolvedValue(success(''));
    mockedRunCommandWithTimeout
      .mockResolvedValueOnce({ exitCode: 1, stderr: 'ImageVolume is disabled', stdout: '' })
      .mockResolvedValueOnce(success(''));

    await expect(verifyKubernetesImageVolumeRuntime(target())).rejects.toThrow('ImageVolume is disabled');
    expect(mockedRunCommandWithTimeout.mock.calls.some((call): boolean => call[0].includes('delete'))).toBe(true);
  });

  it('accepts the exact Pod returned by a server that preserves the image volume and mount', async (): Promise<void> => {
    mockedRunCommandWithInput.mockImplementation(
      async (_command, input) =>
        await Promise.resolve({
          exitCode: 0,
          stderr: '',
          stdout: input,
        }),
    );

    await expect(assertKubernetesImageVolumeCapability(target())).resolves.toBeUndefined();
    expect(mockedRunCommandWithInput).toHaveBeenCalledOnce();
    expect(mockedRunCommandWithInput.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining(['create', '--dry-run=server', '--filename=-', '--output=json']),
    );
  });

  it('rejects a Kubernetes 1.33 response that prunes the image volume and its mount', async (): Promise<void> => {
    mockedRunCommandWithInput.mockImplementation(async (_command, input) => {
      await Promise.resolve(input);
      return {
        exitCode: 0,
        stderr: '',
        stdout: JSON.stringify({ spec: { containers: [{ name: 'probe' }] } }),
      };
    });

    await expect(assertKubernetesImageVolumeCapability(target())).rejects.toThrow(
      'enable ImageVolume=true on kube-apiserver and every eligible kubelet',
    );
  });

  it('fails closed when the server rejects the dry-run', async (): Promise<void> => {
    mockedRunCommandWithInput.mockResolvedValue({ exitCode: 1, stderr: 'admission denied', stdout: '' });

    await expect(assertKubernetesImageVolumeCapability(target())).rejects.toThrow(
      'Kubernetes ImageVolume capability probe failed: admission denied',
    );
  });
});

function target(): KubernetesImageVolumeCapabilityTarget {
  return { kubeContext: 'production', namespace: 'compartment' };
}

function success(stdout: string): CommandResult {
  return { exitCode: 0, stderr: '', stdout };
}
