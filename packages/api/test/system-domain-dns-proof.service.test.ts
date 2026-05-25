import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { DomainDnsRecord } from '@compartment/contracts';
import { buildCompartmentDomainOwnershipValue } from '../src/services/domain-ownership-dns.service';
import {
  buildRequiredSystemDomainDnsRecords,
  verifySystemDomainDnsProof,
} from '../src/services/system-domain-dns-proof.service';
import type { ApiPublicIngressConfig } from '../src/config';

type ResolveTxt = (hostname: string) => Promise<string[][]>;
type ResolveAddress = (hostname: string) => Promise<string[]>;

interface DnsMocks {
  resolve4: Mock<ResolveAddress>;
  resolve6: Mock<ResolveAddress>;
  resolveCname: Mock<ResolveAddress>;
  resolveTxt: Mock<ResolveTxt>;
}

const publicIpv4Address: string = buildIpv4Address([8, 8, 8, 8]);
const mismatchedPublicIpv4Address: string = buildIpv4Address([1, 1, 1, 1]);
const publicIpv6Address: string = buildIpv6Address(['2606', '4700', '4700', '0', '0', '0', '0', '1111']);

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

beforeEach((): void => {
  mocks.resolveCname.mockResolvedValue([]);
  mocks.resolve4.mockResolvedValue([publicIpv4Address]);
  mocks.resolve6.mockResolvedValue([]);
  mocks.resolveTxt.mockResolvedValue([[buildCompartmentDomainOwnershipValue('domop_123')]]);
});

describe('system domain dns proof service', (): void => {
  it('builds ownership and direct ingress routing records', (): void => {
    expect(
      buildRequiredSystemDomainDnsRecords({
        pendingBaseDomain: 'customer.example.com',
        pendingOperationId: 'domop_123',
        publicIngressConfig: createDualStackIngressConfig(),
      }),
    ).toEqual<DomainDnsRecord[]>([
      {
        groupId: 'ownership',
        name: '_compartment-domain.customer.example.com',
        purpose: 'ownership',
        recordType: 'TXT',
        required: true,
        value: 'compartment-domain-verification=domop_123',
      },
      {
        groupId: 'routing',
        name: 'console.customer.example.com',
        purpose: 'routing',
        recordType: 'A',
        required: true,
        value: publicIpv4Address,
      },
      {
        groupId: 'routing',
        name: 'console.customer.example.com',
        purpose: 'routing',
        recordType: 'AAAA',
        required: true,
        value: publicIpv6Address,
      },
      {
        groupId: 'routing',
        name: '*.customer.example.com',
        purpose: 'routing',
        recordType: 'A',
        required: true,
        value: publicIpv4Address,
      },
      {
        groupId: 'routing',
        name: '*.customer.example.com',
        purpose: 'routing',
        recordType: 'AAAA',
        required: true,
        value: publicIpv6Address,
      },
    ]);
  });

  it('verifies ownership and direct ingress binding', async (): Promise<void> => {
    mocks.resolve6.mockResolvedValue([publicIpv6Address]);

    await expect(
      verifySystemDomainDnsProof({
        pendingBaseDomain: 'customer.example.com',
        pendingOperationId: 'domop_123',
        publicIngressConfig: createDualStackIngressConfig(),
      }),
    ).resolves.toEqual({
      failure: null,
    });
  });

  it('rejects missing ownership TXT', async (): Promise<void> => {
    mocks.resolveTxt.mockResolvedValue([['wrong-token']]);

    await expect(
      verifySystemDomainDnsProof({
        pendingBaseDomain: 'customer.example.com',
        pendingOperationId: 'domop_123',
        publicIngressConfig: createIpv4OnlyIngressConfig(),
      }),
    ).resolves.toEqual({
      failure: {
        code: 'dns_ownership_invalid',
        message:
          'Ownership TXT _compartment-domain.customer.example.com must equal compartment-domain-verification=domop_123.',
      },
    });
  });

  it('rejects mismatched direct ingress answers', async (): Promise<void> => {
    mocks.resolve4.mockResolvedValue([mismatchedPublicIpv4Address]);

    await expect(
      verifySystemDomainDnsProof({
        pendingBaseDomain: 'customer.example.com',
        pendingOperationId: 'domop_123',
        publicIngressConfig: createIpv4OnlyIngressConfig(),
      }),
    ).resolves.toEqual({
      failure: {
        code: 'dns_binding_invalid',
        message: 'DNS for console.customer.example.com must point at this installation public ingress.',
      },
    });
  });

  it('rejects CNAME-based ingress answers', async (): Promise<void> => {
    mocks.resolveCname.mockResolvedValue(['edge.customer.example.com']);

    await expect(
      verifySystemDomainDnsProof({
        pendingBaseDomain: 'customer.example.com',
        pendingOperationId: 'domop_123',
        publicIngressConfig: createIpv4OnlyIngressConfig(),
      }),
    ).resolves.toEqual({
      failure: {
        code: 'dns_binding_indirect',
        message: 'DNS for console.customer.example.com must use direct A/AAAA records instead of CNAME.',
      },
    });
  });

  it('rejects unsafe direct ingress answers', async (): Promise<void> => {
    mocks.resolve4.mockResolvedValue(['127.0.0.1']);

    await expect(
      verifySystemDomainDnsProof({
        pendingBaseDomain: 'customer.example.com',
        pendingOperationId: 'domop_123',
        publicIngressConfig: createIpv4OnlyIngressConfig(),
      }),
    ).resolves.toEqual({
      failure: {
        code: 'dns_binding_unsafe',
        message: 'DNS for console.customer.example.com resolves to unsafe address 127.0.0.1.',
      },
    });
  });

  it('rejects unsafe IPv4-mapped IPv6 direct ingress answers', async (): Promise<void> => {
    mocks.resolve4.mockResolvedValue([]);
    mocks.resolve6.mockResolvedValue([buildIpv4MappedIpv6Address('127.0.0.1')]);

    await expect(
      verifySystemDomainDnsProof({
        pendingBaseDomain: 'customer.example.com',
        pendingOperationId: 'domop_123',
        publicIngressConfig: createIpv6OnlyIngressConfig(),
      }),
    ).resolves.toEqual({
      failure: {
        code: 'dns_binding_unsafe',
        message: 'DNS for console.customer.example.com resolves to unsafe address ::ffff:127.0.0.1.',
      },
    });
  });

  it('rejects verification when public ingress config is missing', async (): Promise<void> => {
    await expect(
      verifySystemDomainDnsProof({
        pendingBaseDomain: 'customer.example.com',
        pendingOperationId: 'domop_123',
        publicIngressConfig: createEmptyIngressConfig(),
      }),
    ).resolves.toEqual({
      failure: {
        code: 'dns_binding_invalid',
        message:
          'System domain verification requires COMPARTMENT_PUBLIC_INGRESS_IPV4 or COMPARTMENT_PUBLIC_INGRESS_IPV6.',
      },
    });
  });
});

function createIpv4OnlyIngressConfig(): ApiPublicIngressConfig {
  return {
    publicIngressIpv4: publicIpv4Address,
    publicIngressIpv6: null,
  };
}

function createDualStackIngressConfig(): ApiPublicIngressConfig {
  return {
    publicIngressIpv4: publicIpv4Address,
    publicIngressIpv6: publicIpv6Address,
  };
}

function createIpv6OnlyIngressConfig(): ApiPublicIngressConfig {
  return {
    publicIngressIpv4: null,
    publicIngressIpv6: publicIpv6Address,
  };
}

function createEmptyIngressConfig(): ApiPublicIngressConfig {
  return {
    publicIngressIpv4: null,
    publicIngressIpv6: null,
  };
}

function buildIpv4Address(octets: readonly [number, number, number, number]): string {
  return octets.join('.');
}

function buildIpv6Address(segments: readonly [string, string, string, string, string, string, string, string]): string {
  return segments.join(':');
}

function buildIpv4MappedIpv6Address(ipv4Address: string): string {
  return `::ffff:${ipv4Address}`;
}
