import { describe, expect, it, vi, type Mock } from 'vitest';
import type { DomainHostPlan } from '@compartment/contracts';
import { hashToken } from '../src/lib/tokens';
import { buildCustomDomainDnsRecords, verifyCustomDomainDns } from '../src/services/custom-domain-dns.service';
import { buildCompartmentDomainOwnershipValue } from '../src/services/domain-ownership-dns.service';
import type { CustomDomainDnsConfig } from '../src/services/custom-domain-dns.service.types';

type ResolveTxt = (hostname: string) => Promise<string[][]>;
type ResolveAddress = (hostname: string) => Promise<string[]>;

interface DnsMocks {
  resolve4: Mock<ResolveAddress>;
  resolve6: Mock<ResolveAddress>;
  resolveCname: Mock<ResolveAddress>;
  resolveTxt: Mock<ResolveTxt>;
}

const mocks: DnsMocks = vi.hoisted(
  (): DnsMocks => ({
    resolve4: vi.fn<ResolveAddress>(),
    resolve6: vi.fn<ResolveAddress>(),
    resolveCname: vi.fn<ResolveAddress>(),
    resolveTxt: vi.fn<ResolveTxt>(),
  }),
);

vi.mock(
  'node:dns/promises',
  (): DnsMocks => ({
    resolve4: mocks.resolve4,
    resolve6: mocks.resolve6,
    resolveCname: mocks.resolveCname,
    resolveTxt: mocks.resolveTxt,
  }),
);

describe('custom domain DNS service', (): void => {
  it('builds canonical routing records for managed installs', (): void => {
    expect(
      buildCustomDomainDnsRecords({
        canonicalRouteHost: 'billing.example.compartment.run',
        config: createDnsConfig(),
        domainId: 'cdom_123',
        host: 'app.example.com',
        hostPlan: createManagedHostPlan(),
      }),
    ).toEqual([
      {
        groupId: 'ownership',
        name: '_compartment-domain.app.example.com',
        purpose: 'ownership',
        recordType: 'TXT',
        required: true,
        value: 'compartment-domain-verification=cdom_123',
      },
      {
        groupId: 'routing',
        name: 'app.example.com',
        purpose: 'routing',
        recordType: 'CNAME',
        required: true,
        value: 'billing.example.compartment.run',
      },
    ]);
  });

  it('validates managed ownership and canonical routing DNS', async (): Promise<void> => {
    mocks.resolveTxt.mockResolvedValue([[buildCompartmentDomainOwnershipValue('cdom_123')]]);
    mocks.resolveCname.mockResolvedValue(['billing.example.compartment.run.']);

    await expect(
      verifyCustomDomainDns({
        canonicalRouteHost: 'billing.example.compartment.run',
        config: createDnsConfig(),
        domainId: 'cdom_123',
        host: 'app.example.com',
        hostPlan: createManagedHostPlan(),
        verificationTokenHash: hashToken(buildCompartmentDomainOwnershipValue('cdom_123'), 'test-session-secret'),
      }),
    ).resolves.toEqual({
      failureMessage: null,
      ownershipStatus: 'valid',
      routingStatus: 'valid',
    });
  });

  it('rejects managed routing through a different CNAME', async (): Promise<void> => {
    mocks.resolveTxt.mockResolvedValue([[buildCompartmentDomainOwnershipValue('cdom_123')]]);
    mocks.resolveCname.mockResolvedValue(['other.example.compartment.run.']);

    await expect(
      verifyCustomDomainDns({
        canonicalRouteHost: 'billing.example.compartment.run',
        config: createDnsConfig(),
        domainId: 'cdom_123',
        host: 'app.example.com',
        hostPlan: createManagedHostPlan(),
        verificationTokenHash: hashToken(buildCompartmentDomainOwnershipValue('cdom_123'), 'test-session-secret'),
      }),
    ).resolves.toEqual({
      failureMessage: 'Routing DNS records are not valid yet.',
      ownershipStatus: 'valid',
      routingStatus: 'invalid',
    });
  });

  it('validates issuer-backed subdomain routing with CNAME', async (): Promise<void> => {
    mocks.resolveTxt.mockResolvedValue([[buildCompartmentDomainOwnershipValue('cdom_123')]]);
    mocks.resolveCname.mockResolvedValue(['billing.customer.example.com.']);

    await expect(
      verifyCustomDomainDns({
        canonicalRouteHost: 'billing.customer.example.com',
        config: createDnsConfig(),
        domainId: 'cdom_123',
        host: 'app.example.com',
        hostPlan: createOperatorHostPlan(),
        verificationTokenHash: hashToken(buildCompartmentDomainOwnershipValue('cdom_123'), 'test-session-secret'),
      }),
    ).resolves.toMatchObject({
      ownershipStatus: 'valid',
      routingStatus: 'valid',
    });
  });

  it('validates issuer-backed public-suffix apex routing with flattened addresses', async (): Promise<void> => {
    mocks.resolveTxt.mockResolvedValue([[buildCompartmentDomainOwnershipValue('cdom_123')]]);
    mocks.resolveCname.mockResolvedValue([]);
    mocks.resolve4.mockResolvedValue(['203.0.113.10']);
    mocks.resolve6.mockResolvedValue([]);

    await expect(
      verifyCustomDomainDns({
        canonicalRouteHost: 'billing.customer.example.com',
        config: createDnsConfig(),
        domainId: 'cdom_123',
        host: 'example.co.uk',
        hostPlan: createOperatorHostPlan(),
        verificationTokenHash: hashToken(buildCompartmentDomainOwnershipValue('cdom_123'), 'test-session-secret'),
      }),
    ).resolves.toMatchObject({
      ownershipStatus: 'valid',
      routingStatus: 'valid',
    });
  });

  it('rejects issuer-backed public-suffix apex routing with stray flattened addresses', async (): Promise<void> => {
    mocks.resolveTxt.mockResolvedValue([[buildCompartmentDomainOwnershipValue('cdom_123')]]);
    mocks.resolveCname.mockResolvedValue([]);
    mocks.resolve4.mockImplementation(
      async (hostname: string): Promise<string[]> =>
        await Promise.resolve(hostname === 'example.co.uk' ? ['203.0.113.10', '203.0.113.99'] : ['203.0.113.10']),
    );
    mocks.resolve6.mockResolvedValue([]);

    await expect(
      verifyCustomDomainDns({
        canonicalRouteHost: 'billing.customer.example.com',
        config: createDnsConfig(),
        domainId: 'cdom_123',
        host: 'example.co.uk',
        hostPlan: createOperatorHostPlan(),
        verificationTokenHash: hashToken(buildCompartmentDomainOwnershipValue('cdom_123'), 'test-session-secret'),
      }),
    ).resolves.toMatchObject({
      ownershipStatus: 'valid',
      routingStatus: 'invalid',
    });
  });

  it('rejects issuer-backed public-suffix apex routing with CNAME', async (): Promise<void> => {
    mocks.resolveTxt.mockResolvedValue([[buildCompartmentDomainOwnershipValue('cdom_123')]]);
    mocks.resolveCname.mockResolvedValue(['billing.customer.example.com.']);
    mocks.resolve4.mockResolvedValue(['203.0.113.10']);
    mocks.resolve6.mockResolvedValue([]);

    await expect(
      verifyCustomDomainDns({
        canonicalRouteHost: 'billing.customer.example.com',
        config: createDnsConfig(),
        domainId: 'cdom_123',
        host: 'example.co.uk',
        hostPlan: createOperatorHostPlan(),
        verificationTokenHash: hashToken(buildCompartmentDomainOwnershipValue('cdom_123'), 'test-session-secret'),
      }),
    ).resolves.toMatchObject({
      ownershipStatus: 'valid',
      routingStatus: 'invalid',
    });
    expect(mocks.resolve4).not.toHaveBeenCalled();
    expect(mocks.resolve6).not.toHaveBeenCalled();
  });

  it('builds provider-neutral apex routing guidance for issuer-backed apex hosts', (): void => {
    expect(
      buildCustomDomainDnsRecords({
        canonicalRouteHost: 'billing.customer.example.com',
        config: createDnsConfig(),
        domainId: 'cdom_123',
        host: 'example.co.uk',
        hostPlan: createOperatorHostPlan(),
      }),
    ).toEqual([
      {
        groupId: 'ownership',
        name: '_compartment-domain.example.co.uk',
        purpose: 'ownership',
        recordType: 'TXT',
        required: true,
        value: 'compartment-domain-verification=cdom_123',
      },
      {
        groupId: 'routing',
        name: 'example.co.uk',
        purpose: 'routing',
        recordType: 'APEX_ALIAS',
        required: false,
        value: 'billing.customer.example.com',
      },
    ]);
  });
});

function createDnsConfig(): CustomDomainDnsConfig {
  return {
    targets: [
      { type: 'A', value: '203.0.113.10' },
      { type: 'AAAA', value: '2001:db8::10' },
    ],
    sessionSecret: 'test-session-secret',
  };
}

function createManagedHostPlan(): DomainHostPlan {
  return {
    baseDomain: 'example.compartment.run',
    domainKind: 'managed',
    publicScheme: 'https',
    tlsMode: 'broker-dns01',
  };
}

function createOperatorHostPlan(): DomainHostPlan {
  return {
    baseDomain: 'customer.example.com',
    domainKind: 'custom',
    publicScheme: 'https',
    tlsMode: 'external',
  };
}
