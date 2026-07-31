import { describe, expect, it } from 'vitest';
import {
  managedDomainAllocationResponseSchema,
  type ManagedDomainAllocationRequest,
  type ManagedDomainAllocationResponse,
} from '../src';

describe('managed-domain broker contracts', (): void => {
  it('parses the main broker allocation response', (): void => {
    const response: ManagedDomainAllocationResponse = managedDomainAllocationResponseSchema.parse({
      acmeDnsToken: 'acme-dns-token',
      baseDomain: 'acme.compartment.run',
      dnsRecords: [{ host: '*.acme.compartment.run', purpose: 'Managed ingress', type: 'A/AAAA-or-CNAME' }],
      futureBrokerField: 'forward-compatible',
    });
    expect(response).toEqual({
      acmeDnsToken: 'acme-dns-token',
      baseDomain: 'acme.compartment.run',
    });
  });

  it('requires a public IP in the allocation request type', (): void => {
    const publicIp: string = [8, 8, 8, 8].join('.');
    const request: ManagedDomainAllocationRequest = {
      installationId: 'installation-123',
      publicIp,
      requestedLabelSource: 'Acme Dev',
    };
    expect(request.publicIp).toBe(publicIp);
  });

  it('rejects incomplete allocation responses', (): void => {
    expect(managedDomainAllocationResponseSchema.safeParse({ baseDomain: 'acme.compartment.run' }).success).toBe(false);
  });
});
