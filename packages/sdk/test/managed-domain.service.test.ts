import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ManagedDomainDns01ChallengeRequest } from '@compartment/contracts';
import { createCompartmentRequester } from '../src/http/request';
import {
  bindManagedDomainTargets,
  cleanUpManagedDomainDns01Challenge,
  presentManagedDomainDns01Challenge,
  replayManagedDomainDesiredState,
  reserveManagedDomain,
} from '../src/services/managed-domain.service';
import type { CompartmentRequester } from '../src/http/request.types';

describe('managed-domain broker service', (): void => {
  afterEach((): void => {
    vi.unstubAllGlobals();
  });

  it('reserves without a target and binds typed targets separately', async (): Promise<void> => {
    const fetchMock: Mock<(url: string, init: RequestInit) => Promise<Response>> = vi
      .fn<(url: string, init: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(
        Response.json({
          allocationId: 'allocation-1',
          baseDomain: 'acme.compartment.run',
          scopedToken: 'allocation-token',
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          allocationId: 'allocation-1',
          targets: [{ type: 'hostname', value: 'shared-lb.example.com' }],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ name: '_acme-challenge.acme.compartment.run', value: 'challenge-value' }, { status: 201 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({ allocationId: 'allocation-1', challengeCount: 0, targetCount: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    const request: CompartmentRequester = createCompartmentRequester({ apiUrl: 'https://broker.compartment.run' });

    await reserveManagedDomain(request, 'reservation-token', {
      installationId: 'installation-123',
      requestedLabelSource: 'Acme Dev',
    });
    await bindManagedDomainTargets(request, 'allocation-1', 'allocation-token', {
      targets: [{ type: 'hostname', value: 'shared-lb.example.com' }],
    });
    const challenge: ManagedDomainDns01ChallengeRequest = {
      name: '_acme-challenge.acme.compartment.run',
      value: 'challenge-value',
    };
    await presentManagedDomainDns01Challenge(request, 'allocation-1', 'allocation-token', challenge);
    await cleanUpManagedDomainDns01Challenge(request, 'allocation-1', 'allocation-token', challenge);
    await replayManagedDomainDesiredState(request, 'allocation-1', 'allocation-token');

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://broker.compartment.run/v1/managed-domains/allocations');
    const reservationHeaders: Headers = fetchMock.mock.calls[0]?.[1].headers as Headers;
    expect(reservationHeaders.get('Authorization')).toBe('Bearer reservation-token');
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://broker.compartment.run/v1/managed-domains/allocations/allocation-1/targets',
    );
    const bindingHeaders: Headers = fetchMock.mock.calls[1]?.[1].headers as Headers;
    expect(bindingHeaders.get('Authorization')).toBe('Bearer allocation-token');
    expect(fetchMock.mock.calls[2]?.[1].method).toBe('POST');
    expect(fetchMock.mock.calls[3]?.[1].method).toBe('DELETE');
    expect(fetchMock.mock.calls[4]?.[1].method).toBe('POST');
  });
});
