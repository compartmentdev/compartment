import { afterEach, describe, expect, it, vi, type Mock, type MockInstance } from 'vitest';
import { cleanupWorkerArtifacts } from '../src/services/worker-artifact-cleanup.service';
import type { fetchWorkerArtifactRegistryInternalHttp } from '../src/services/worker-outbound-http.service';
import type { WorkerArtifactRegistryConfig } from '../src/worker-artifact-registry.types';

type FetchWorkerArtifactRegistryInternalHttp = typeof fetchWorkerArtifactRegistryInternalHttp;

const fetchRegistry: Mock<FetchWorkerArtifactRegistryInternalHttp> = vi.hoisted(
  (): Mock<FetchWorkerArtifactRegistryInternalHttp> => vi.fn<FetchWorkerArtifactRegistryInternalHttp>(),
);

vi.mock('../src/services/worker-outbound-http.service', (): object => ({
  fetchWorkerArtifactRegistryInternalHttp: fetchRegistry,
}));

describe('worker artifact cleanup', (): void => {
  afterEach((): void => {
    vi.restoreAllMocks();
    fetchRegistry.mockReset();
  });

  it('deletes retained manifests through the configured internal registry boundary', async (): Promise<void> => {
    fetchRegistry.mockResolvedValue(new Response(null, { status: 202 }));
    const registry: WorkerArtifactRegistryConfig = registryConfig();

    await cleanupWorkerArtifacts(
      [
        {
          artifactId: 'art_old',
          imageRef: 'registry.example/compartment/projects/prj/services/svc@sha256:abc',
        },
      ],
      registry,
    );

    expect(fetchRegistry).toHaveBeenCalledWith(
      registry,
      '/v2/compartment/projects/prj/services/svc/manifests/sha256:abc',
      {
        headers: { Authorization: `Basic ${Buffer.from('writer:write-password').toString('base64')}` },
        method: 'DELETE',
      },
    );
  });

  it('keeps registry cleanup best-effort after the durable retention mark', async (): Promise<void> => {
    const warn: MockInstance<typeof console.warn> = vi.spyOn(console, 'warn').mockImplementation((): void => undefined);
    fetchRegistry.mockResolvedValue(new Response(null, { status: 500 }));

    await expect(
      cleanupWorkerArtifacts(
        [{ artifactId: 'art_old', imageRef: 'registry.example/repo@sha256:abc' }],
        registryConfig(),
      ),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ artifactId: 'art_old' }),
      'Failed to clean retained deployment artifact.',
    );
  });
});

function registryConfig(): WorkerArtifactRegistryConfig {
  return {
    address: 'registry.example',
    internalUrl: 'https://registry-internal.example',
    mode: 'external',
    readCredentials: { password: 'read-password', username: 'reader' },
    writeCredentials: { password: 'write-password', username: 'writer' },
  };
}
