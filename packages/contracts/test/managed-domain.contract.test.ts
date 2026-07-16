import { describe, expect, it } from 'vitest';
import { managedDomainAllocationResponseSchema, type ManagedDomainAllocationResponse } from '../src';

describe('managed-domain allocation contract', (): void => {
  it('parses the canonical allocation response and ignores broker-owned DNS metadata', (): void => {
    const response: ManagedDomainAllocationResponse = managedDomainAllocationResponseSchema.parse({
      acmeDnsToken: 'acme-token',
      baseDomain: 'acme.compartment.run',
      dnsRecords: [{ host: '*.acme.compartment.run', type: 'A' }],
    });

    expect(response).toEqual({
      acmeDnsToken: 'acme-token',
      baseDomain: 'acme.compartment.run',
    });
  });

  it('rejects incomplete allocation responses', (): void => {
    expect(managedDomainAllocationResponseSchema.safeParse({ baseDomain: 'acme.compartment.run' }).success).toBe(false);
  });
});
