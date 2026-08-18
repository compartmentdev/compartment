import { afterEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { runCommandWithInput } from '../src/command-runner';
import { assertKubernetesImageVolumeCapability } from '../src/services/kubernetes-image-volume-preflight.service';
import type { KubernetesImageVolumeCapabilityTarget } from '../src/services/kubernetes-image-volume-preflight.service.types';

vi.mock('../src/command-runner', (): object => ({ runCommandWithInput: vi.fn() }));

const mockedRunCommandWithInput: MockedFunction<typeof runCommandWithInput> = vi.mocked(runCommandWithInput);

describe('Kubernetes ImageVolume capability preflight', (): void => {
  afterEach((): void => {
    vi.clearAllMocks();
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
