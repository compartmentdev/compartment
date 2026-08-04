import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { readReachableManagedVmEndpoints } from '../src/services/managed-vm-network.service';

afterEach((): void => {
  vi.unstubAllGlobals();
});

describe('managed VM download reachability', (): void => {
  it('accepts any response that proves the endpoint is reachable', async (): Promise<void> => {
    const statuses: number[] = [307, 401, 403, 404, 405, 429, 200, 204];
    const fetchMock: Mock<typeof fetch> = vi.fn<typeof fetch>();
    for (const status of statuses) {
      fetchMock.mockResolvedValueOnce(new Response(undefined, { status }));
    }
    vi.stubGlobal('fetch', fetchMock);

    await expect(readReachableManagedVmEndpoints()).resolves.toEqual([
      'https://compartment.dev/install.sh',
      'https://github.com',
      'https://ghcr.io/v2/',
      'https://registry-1.docker.io/v2/',
      'https://get.helm.sh',
      'https://storage.googleapis.com/gvisor/releases/',
      'https://acme-v02.api.letsencrypt.org/directory',
      'https://broker.compartment.run',
    ]);
  });

  it('rejects server failures and transport errors', async (): Promise<void> => {
    const fetchMock: Mock<typeof fetch> = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(new Response(undefined, { status: 500 }));
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    fetchMock.mockResolvedValueOnce(new Response(undefined, { status: 502 }));
    fetchMock.mockRejectedValueOnce(new TypeError('timed out'));
    fetchMock.mockResolvedValueOnce(new Response(undefined, { status: 503 }));
    fetchMock.mockRejectedValueOnce(new TypeError('connection refused'));
    fetchMock.mockRejectedValueOnce(new TypeError('connection reset'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(readReachableManagedVmEndpoints()).resolves.toEqual([]);
  });
});
