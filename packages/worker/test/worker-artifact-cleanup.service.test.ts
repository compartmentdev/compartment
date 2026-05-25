import { afterEach, describe, expect, it, vi, type Mock, type MockInstance } from 'vitest';
import { cleanupWorkerArtifacts } from '../src/services/worker-artifact-cleanup.service';
import type { fetchWorkerArtifactRegistryInternalHttp } from '../src/services/worker-outbound-http.service';

type FetchWorkerArtifactRegistryInternalHttp = typeof fetchWorkerArtifactRegistryInternalHttp;

interface WorkerOutboundHttpMocks {
  fetchWorkerArtifactRegistryInternalHttp: Mock<FetchWorkerArtifactRegistryInternalHttp>;
}

const workerOutboundHttpMocks: WorkerOutboundHttpMocks = vi.hoisted(
  (): WorkerOutboundHttpMocks => ({
    fetchWorkerArtifactRegistryInternalHttp: vi.fn<FetchWorkerArtifactRegistryInternalHttp>(),
  }),
);

vi.mock('../src/services/worker-outbound-http.service', (): WorkerOutboundHttpMocks => workerOutboundHttpMocks);

describe('worker artifact cleanup service', (): void => {
  afterEach((): void => {
    vi.restoreAllMocks();
    workerOutboundHttpMocks.fetchWorkerArtifactRegistryInternalHttp.mockReset();
  });

  it('uses the configured internal registry URL for manifest deletes and skips live bundled registry gc', async (): Promise<void> => {
    const warnSpy: MockInstance<typeof console.warn> = vi
      .spyOn(console, 'warn')
      .mockImplementation((): void => undefined);
    workerOutboundHttpMocks.fetchWorkerArtifactRegistryInternalHttp.mockResolvedValue(
      new Response(null, { status: 202 }),
    );

    await cleanupWorkerArtifacts(
      [
        {
          imageRef: '127.0.0.1:39461/compartment/projects/prj_123/services/svc_123@sha256:abc',
        },
      ],
      {
        address: '127.0.0.1:39461',
        internalUrl: 'http://registry:5000',
        readCredentials: {
          password: 'read-password',
          username: 'reader',
        },
        writeCredentials: {
          password: 'write-password',
          username: 'writer',
        },
      },
      'compartment-prod',
    );

    expect(workerOutboundHttpMocks.fetchWorkerArtifactRegistryInternalHttp).toHaveBeenCalledWith(
      {
        address: '127.0.0.1:39461',
        internalUrl: 'http://registry:5000',
        readCredentials: {
          password: 'read-password',
          username: 'reader',
        },
        writeCredentials: {
          password: 'write-password',
          username: 'writer',
        },
      },
      '/v2/compartment/projects/prj_123/services/svc_123/manifests/sha256:abc',
      {
        headers: {
          Authorization: `Basic ${Buffer.from('writer:write-password', 'utf8').toString('base64')}`,
        },
        method: 'DELETE',
      },
    );
    expect(warnSpy).toHaveBeenCalledWith(
      {
        dockerNamespace: 'compartment-prod',
        reason: 'Bundled registry garbage collection requires a read-only maintenance path.',
      },
      'Skipped bundled registry garbage collection after deleting retained deployment manifests.',
    );
  });

  it('keeps cleanup failures best-effort and skips gc warning when manifest deletes fail', async (): Promise<void> => {
    const warnSpy: MockInstance<typeof console.warn> = vi
      .spyOn(console, 'warn')
      .mockImplementation((): void => undefined);
    workerOutboundHttpMocks.fetchWorkerArtifactRegistryInternalHttp.mockResolvedValue(
      new Response(null, { status: 500 }),
    );

    await expect(
      cleanupWorkerArtifacts(
        [
          {
            imageRef: 'registry.example/compartment/projects/prj_123/services/svc_123@sha256:abc',
          },
        ],
        {
          address: 'registry.example',
          internalUrl: 'http://registry-internal.example:5000',
          readCredentials: {
            password: 'read-password',
            username: 'reader',
          },
          writeCredentials: {
            password: 'write-password',
            username: 'writer',
          },
        },
        'compartment-prod',
      ),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalledWith(
      {
        dockerNamespace: 'compartment-prod',
        reason: 'Bundled registry garbage collection requires a read-only maintenance path.',
      },
      'Skipped bundled registry garbage collection after deleting retained deployment manifests.',
    );
  });
});
