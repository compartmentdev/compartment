import { describe, expect, it } from 'vitest';
import {
  managedDomainDns01ChallengeRequestSchema,
  managedDomainReservationResponseSchema,
  managedDomainTargetBindingRequestSchema,
  managedDomainTargetBindingResponseSchema,
  type ManagedDomainReservationResponse,
  type ManagedDomainTargetBindingResponse,
} from '../src';

describe('managed-domain broker contracts', (): void => {
  const ipv4: string = [8, 8, 8, 8].join('.');
  const ipv6: string = ['2001', '4860', '4860', '', '8888'].join(':');
  it('reserves an allocation without an ingress target', (): void => {
    const response: ManagedDomainReservationResponse = managedDomainReservationResponseSchema.parse({
      allocationId: 'allocation-1',
      baseDomain: 'acme.compartment.run',
      scopedToken: 'allocation-token',
    });
    expect(response).toEqual({
      allocationId: 'allocation-1',
      baseDomain: 'acme.compartment.run',
      scopedToken: 'allocation-token',
    });
  });

  it('preserves typed A, AAAA, and hostname targets', (): void => {
    const response: ManagedDomainTargetBindingResponse = managedDomainTargetBindingResponseSchema.parse({
      allocationId: 'allocation-1',
      targets: [
        { type: 'A', value: ipv4 },
        { type: 'AAAA', value: ipv6 },
        { type: 'hostname', value: 'shared-lb.example.com' },
      ],
    });
    expect(response.targets[2]).toEqual({ type: 'hostname', value: 'shared-lb.example.com' });
  });

  it('rejects an IP address encoded as a hostname target', (): void => {
    expect(
      managedDomainTargetBindingResponseSchema.safeParse({
        allocationId: 'allocation-1',
        targets: [{ type: 'hostname', value: ipv4 }],
      }).success,
    ).toBe(false);
  });

  it('rejects malformed binding and challenge requests at the contract boundary', (): void => {
    expect(managedDomainTargetBindingRequestSchema.safeParse({ targets: [] }).success).toBe(false);
    expect(
      managedDomainTargetBindingRequestSchema.safeParse({ targets: [{ type: 'A', value: '999.1.1.1' }] }).success,
    ).toBe(false);
    expect(
      managedDomainTargetBindingRequestSchema.safeParse({ targets: [{ type: 'AAAA', value: 'not:ipv6' }] }).success,
    ).toBe(false);
    expect(
      managedDomainTargetBindingRequestSchema.safeParse({
        targets: [{ type: 'hostname', value: ipv4 }],
      }).success,
    ).toBe(false);
    expect(
      managedDomainDns01ChallengeRequestSchema.safeParse({
        extra: true,
        name: '_acme-challenge.acme.compartment.run',
        value: 'proof',
      }).success,
    ).toBe(false);
  });
});
