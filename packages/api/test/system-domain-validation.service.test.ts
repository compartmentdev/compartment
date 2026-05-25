import type { DomainHostPlan } from '@compartment/contracts';
import { describe, expect, it } from 'vitest';
import {
  normalizeAndValidatePendingDomainHostPlan,
  normalizeAndValidateRuntimeDomainHostPlan,
} from '../src/services/system-domain-validation.service';

describe('system domain validation service', (): void => {
  it('allows runtime managed plans with a shared baseDomain contract', (): void => {
    const hostPlan: DomainHostPlan = normalizeAndValidateRuntimeDomainHostPlan({
      baseDomain: 'example.compartment.run',
      caddyMode: 'managed',
      domainKind: 'managed',
      publicScheme: 'https',
      tlsMode: 'broker-dns01',
    });

    expect(hostPlan.baseDomain).toBe('example.compartment.run');
  });

  it('allows runtime custom internal mode for explicit base-domain installs', (): void => {
    const hostPlan: DomainHostPlan = normalizeAndValidateRuntimeDomainHostPlan({
      baseDomain: 'customer.example.com',
      caddyMode: 'internal',
      domainKind: 'custom',
      publicScheme: 'http',
      tlsMode: 'internal',
    });

    expect(hostPlan.baseDomain).toBe('customer.example.com');
  });

  it('allows runtime HTTPS local internal mode for secure browser cookies', (): void => {
    const hostPlan: DomainHostPlan = normalizeAndValidateRuntimeDomainHostPlan({
      baseDomain: '127.0.0.1.sslip.io',
      caddyMode: 'internal',
      domainKind: 'local',
      publicScheme: 'https',
      tlsMode: 'internal',
    });

    expect(hostPlan.publicScheme).toBe('https');
  });

  it('keeps legacy runtime HTTP host plans readable for migration', (): void => {
    const localHostPlan: DomainHostPlan = normalizeAndValidateRuntimeDomainHostPlan({
      baseDomain: '127.0.0.1.sslip.io',
      caddyMode: 'internal',
      domainKind: 'local',
      publicScheme: 'http',
      tlsMode: 'internal',
    });
    const customHttpHostPlan: DomainHostPlan = normalizeAndValidateRuntimeDomainHostPlan({
      baseDomain: 'customer.example.com',
      caddyMode: 'custom-http',
      domainKind: 'custom',
      publicScheme: 'http',
      tlsMode: 'external',
    });

    expect(localHostPlan.publicScheme).toBe('http');
    expect(customHttpHostPlan.publicScheme).toBe('http');
  });

  it('rejects unsupported domain and TLS combinations', (): void => {
    expect(
      (): DomainHostPlan =>
        normalizeAndValidatePendingDomainHostPlan(
          {
            baseDomain: 'customer.example.com',
            caddyMode: 'managed',
            domainKind: 'custom',
            publicScheme: 'https',
            tlsMode: 'broker-dns01',
          },
          'localhost',
        ),
    ).toThrow('Unsupported pending domain/TLS combination');

    expect(
      (): DomainHostPlan =>
        normalizeAndValidatePendingDomainHostPlan(
          {
            baseDomain: 'customer.example.com',
            caddyMode: 'custom-http',
            domainKind: 'custom',
            publicScheme: 'http',
            tlsMode: 'external',
          },
          'localhost',
        ),
    ).toThrow('Unsupported pending domain/TLS combination');
  });

  it('rejects managed and local plans for pending domain operations', (): void => {
    expect(
      (): DomainHostPlan =>
        normalizeAndValidatePendingDomainHostPlan(
          {
            baseDomain: 'example.compartment.run',
            caddyMode: 'managed',
            domainKind: 'managed',
            publicScheme: 'https',
            tlsMode: 'broker-dns01',
          },
          'localhost',
        ),
    ).toThrow('Unsupported pending domain/TLS combination');

    expect(
      (): DomainHostPlan =>
        normalizeAndValidatePendingDomainHostPlan(
          {
            baseDomain: 'localhost',
            caddyMode: 'internal',
            domainKind: 'local',
            publicScheme: 'http',
            tlsMode: 'internal',
          },
          'localhost',
        ),
    ).toThrow('Unsupported pending domain/TLS combination');
  });

  it('allows custom certificate host plans for pending domain operations', (): void => {
    const hostPlan: DomainHostPlan = normalizeAndValidatePendingDomainHostPlan(
      {
        baseDomain: 'customer.example.com',
        caddyMode: 'custom-cert',
        domainKind: 'custom',
        publicScheme: 'https',
        tlsMode: 'custom-cert',
      },
      'localhost',
    );

    expect(hostPlan.tlsMode).toBe('custom-cert');
  });

  it('rejects custom base domains that overlap the active baseDomain', (): void => {
    expect(
      (): DomainHostPlan =>
        normalizeAndValidatePendingDomainHostPlan(
          {
            baseDomain: 'customer.current.example.com',
            caddyMode: 'custom-http',
            domainKind: 'custom',
            publicScheme: 'https',
            tlsMode: 'external',
          },
          'current.example.com',
        ),
    ).toThrow('custom baseDomain must not overlap the active baseDomain');
  });

  it('rejects custom apex base domains', (): void => {
    expect(
      (): DomainHostPlan =>
        normalizeAndValidatePendingDomainHostPlan(
          {
            baseDomain: 'example.com',
            caddyMode: 'custom-http',
            domainKind: 'custom',
            publicScheme: 'https',
            tlsMode: 'external',
          },
          'localhost',
        ),
    ).toThrow('custom baseDomain must use a delegated subdomain');
  });
});
