import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadManagedVmArtifacts } from '../src/services/managed-vm-artifacts.service';
import type { ManagedVmArtifact } from '../src/services/managed-vm-provisioning.types';

afterEach((): void => {
  vi.unstubAllGlobals();
});

describe('managed VM artifacts', (): void => {
  it('rejects unverified bytes before an artifact can be installed', async (): Promise<void> => {
    vi.stubGlobal(
      'fetch',
      vi.fn((): Response => new Response('unexpected bytes')),
    );
    const artifact: ManagedVmArtifact = {
      name: 'k3s',
      sha256: '0'.repeat(64),
      url: 'https://releases.example.test/k3s',
      version: 'v1.36.2+k3s1',
    };
    await expect(downloadManagedVmArtifacts([artifact])).rejects.toThrow('k3s digest verification failed');
  });
});
