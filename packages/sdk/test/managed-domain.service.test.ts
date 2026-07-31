import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createCompartmentRequester } from '../src/http/request';
import { allocateManagedDomain } from '../src/services/managed-domain.service';
import type { CompartmentRequester } from '../src/http/request.types';

describe('managed-domain broker service', (): void => {
  afterEach((): void => {
    vi.unstubAllGlobals();
  });

  it('allocates with one unauthenticated POST using publicIp', async (): Promise<void> => {
    const publicIp: string = [8, 8, 8, 8].join('.');
    const fetchMock: Mock<(url: string, init: RequestInit) => Promise<Response>> = vi
      .fn<(url: string, init: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(
        Response.json({
          acmeDnsToken: 'acme-dns-token',
          baseDomain: 'acme.compartment.run',
          dnsRecords: [{ host: '*.acme.compartment.run', purpose: 'Managed ingress', type: 'A/AAAA-or-CNAME' }],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const request: CompartmentRequester = createCompartmentRequester({
      apiUrl: 'https://broker.compartment.run',
      sessionToken: 'unrelated-default-token',
    });

    await allocateManagedDomain(request, {
      installationId: 'installation-123',
      publicIp,
      requestedLabelSource: 'Acme Dev',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://broker.compartment.run/v1/managed-domains');
    const init: RequestInit = fetchMock.mock.calls[0]![1];
    expect(init.method).toBe('POST');
    expect(init.body).toBe(
      JSON.stringify({
        installationId: 'installation-123',
        publicIp,
        requestedLabelSource: 'Acme Dev',
      }),
    );
    expect((init.headers as Headers).get('Authorization')).toBeNull();
  });
});
