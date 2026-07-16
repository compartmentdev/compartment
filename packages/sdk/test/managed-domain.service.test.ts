import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createCompartmentRequester } from '../src/http/request';
import { allocateManagedDomain } from '../src/services/managed-domain.service';

describe('managed-domain broker service', (): void => {
  const publicIpv4: string = [8, 8, 8, 8].join('.');
  afterEach((): void => {
    vi.unstubAllGlobals();
  });

  it('posts the allocation contract to the canonical broker path', async (): Promise<void> => {
    const fetchMock: Mock<(url: string, init: RequestInit) => Promise<Response>> = vi.fn(
      async (): Promise<Response> =>
        await Promise.resolve(Response.json({ acmeDnsToken: 'acme-token', baseDomain: 'acme.compartment.run' })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      allocateManagedDomain(createCompartmentRequester({ apiUrl: 'https://broker.compartment.run' }), {
        installationId: 'installation-123',
        publicIp: publicIpv4,
        requestedLabelSource: 'Acme Dev',
      }),
    ).resolves.toEqual({ acmeDnsToken: 'acme-token', baseDomain: 'acme.compartment.run' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://broker.compartment.run/v1/managed-domains',
      expect.objectContaining({
        body: JSON.stringify({
          installationId: 'installation-123',
          publicIp: publicIpv4,
          requestedLabelSource: 'Acme Dev',
        }),
        method: 'POST',
      }),
    );
  });
});
