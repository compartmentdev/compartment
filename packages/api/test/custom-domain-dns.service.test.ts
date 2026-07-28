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
  it('builds public IP routing records for managed installs', (): void => {
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
        recordType: 'A',
        required: true,
        value: '203.0.113.10',
      },
      {
        groupId: 'routing',
        name: 'app.example.com',
        purpose: 'routing',
        recordType: 'AAAA',
        required: true,
        value: '2001:db8::10',
      },
    ]);
  });

  it('validates managed ownership and public IP routing DNS', async (): Promise<void> => {
    mocks.resolveTxt.mockResolvedValue([[buildCompartmentDomainOwnershipValue('cdom_123')]]);
    mocks.resolve4.mockResolvedValue(['203.0.113.10']);
    mocks.resolve6.mockResolvedValue(['2001:db8::10']);

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

  it('rejects managed routing through CNAME chains', async (): Promise<void> => {
    mocks.resolveTxt.mockResolvedValue([[buildCompartmentDomainOwnershipValue('cdom_123')]]);
    mocks.resolveCname.mockResolvedValue(['billing.example.compartment.run.']);
    mocks.resolve4.mockResolvedValue(['203.0.113.10']);
    mocks.resolve6.mockResolvedValue(['2001:db8::10']);

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
    expect(mocks.resolve4).not.toHaveBeenCalled();
    expect(mocks.resolve6).not.toHaveBeenCalled();
  });

  it('rejects managed routing with stray address records', async (): Promise<void> => {
    mocks.resolveTxt.mockResolvedValue([[buildCompartmentDomainOwnershipValue('cdom_123')]]);
    mocks.resolve4.mockResolvedValue(['203.0.113.10']);
    mocks.resolve6.mockResolvedValue(['2001:db8::99']);

    await expect(
      verifyCustomDomainDns({
        canonicalRouteHost: 'billing.example.compartment.run',
        config: createIpv4OnlyDnsConfig(),
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

  it('validates custom-cert subdomain routing with CNAME', async (): Promise<void> => {
    mocks.resolveTxt.mockResolvedValue([[buildCompartmentDomainOwnershipValue('cdom_123')]]);
    mocks.resolveCname.mockResolvedValue(['billing.customer.example.com.']);

    await expect(
      verifyCustomDomainDns({
        canonicalRouteHost: 'billing.customer.example.com',
        config: createDnsConfig(),
        domainId: 'cdom_123',
        host: 'app.example.com',
        hostPlan: createCustomCertHostPlan(),
        verificationTokenHash: hashToken(buildCompartmentDomainOwnershipValue('cdom_123'), 'test-session-secret'),
      }),
    ).resolves.toMatchObject({
      ownershipStatus: 'valid',
      routingStatus: 'valid',
    });
  });

  it('validates custom-cert public-suffix apex routing with flattened addresses', async (): Promise<void> => {
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
        hostPlan: createCustomCertHostPlan(),
        verificationTokenHash: hashToken(buildCompartmentDomainOwnershipValue('cdom_123'), 'test-session-secret'),
      }),
    ).resolves.toMatchObject({
      ownershipStatus: 'valid',
      routingStatus: 'valid',
    });
  });

  it('rejects custom-cert public-suffix apex routing with stray flattened addresses', async (): Promise<void> => {
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
        hostPlan: createCustomCertHostPlan(),
        verificationTokenHash: hashToken(buildCompartmentDomainOwnershipValue('cdom_123'), 'test-session-secret'),
      }),
    ).resolves.toMatchObject({
      ownershipStatus: 'valid',
      routingStatus: 'invalid',
    });
  });

  it('rejects custom-cert public-suffix apex routing with CNAME', async (): Promise<void> => {
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
        hostPlan: createCustomCertHostPlan(),
        verificationTokenHash: hashToken(buildCompartmentDomainOwnershipValue('cdom_123'), 'test-session-secret'),
      }),
    ).resolves.toMatchObject({
      ownershipStatus: 'valid',
      routingStatus: 'invalid',
    });
    expect(mocks.resolve4).not.toHaveBeenCalled();
    expect(mocks.resolve6).not.toHaveBeenCalled();
  });

  it('builds provider-neutral apex routing guidance for custom-cert apex hosts', (): void => {
    expect(
      buildCustomDomainDnsRecords({
        canonicalRouteHost: 'billing.customer.example.com',
        config: createDnsConfig(),
        domainId: 'cdom_123',
        host: 'example.co.uk',
        hostPlan: createCustomCertHostPlan(),
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
    publicIngressIpv4: '203.0.113.10',
    publicIngressIpv6: '2001:db8::10',
    sessionSecret: 'test-session-secret',
  };
}

function createIpv4OnlyDnsConfig(): CustomDomainDnsConfig {
  return {
    ...createDnsConfig(),
    publicIngressIpv6: null,
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

function createCustomCertHostPlan(): DomainHostPlan {
  return {
    baseDomain: 'customer.example.com',
    domainKind: 'custom',
    publicScheme: 'https',
    tlsMode: 'custom-cert',
  };
}
