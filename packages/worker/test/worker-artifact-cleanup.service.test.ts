import { afterEach, describe, expect, it, vi, type Mock, type MockInstance } from 'vitest';
import { cleanupWorkerArtifacts } from '../src/services/worker-artifact-cleanup.service';
import type { fetchWorkerArtifactRegistryInternalHttp } from '../src/services/worker-outbound-http.service';
import type { WorkerArtifactRegistryConfig } from '../src/worker-artifact-registry.types';

type FetchWorkerArtifactRegistryInternalHttp = typeof fetchWorkerArtifactRegistryInternalHttp;
type FetchRegistryCall = [artifactRegistry: WorkerArtifactRegistryConfig, path: string, init?: RequestInit | undefined];

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
          imageRef: `registry.example/projects/prj_123/services/svc_123@sha256:${'a'.repeat(64)}`,
        },
      ],
      registry,
    );

    const call: FetchRegistryCall | undefined = fetchRegistry.mock.calls[0];
    expect(call?.[0]).toBe(registry);
    expect(call?.[1]).toBe(`/v2/projects/prj_123/services/svc_123/manifests/sha256:${'a'.repeat(64)}`);
    expect(call?.[2]?.method).toBe('DELETE');
    expect(new Headers(call?.[2]?.headers).get('Authorization')).toMatch(/^Basic [A-Za-z0-9+/=]+$/u);
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
    credentialSigningKey: 'registry-signing-key-with-at-least-32-characters',
    internalAddress: 'registry-internal.example',
    internalUrl: 'https://registry-internal.example',
  };
}
