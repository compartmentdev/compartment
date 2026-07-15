import { afterEach, describe, expect, it } from 'vitest';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { type ApiConfig, type ApiPublicIngressConfig } from '../src/config';
import type { Database } from '../src/db/client';
import { clearApiRuntime, configureApiRuntime } from '../src/runtime/runtime';
import {
  assertRuntimeSupportsCustomDomains,
  normalizeCustomDomainHost,
} from '../src/services/custom-domain-validation.service';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';

afterEach((): void => {
  clearApiRuntime();
});

describe('custom domain validation service', (): void => {
  it('rejects public suffix hosts that cannot be operator-owned zones', (): void => {
    expect((): string => normalizeCustomDomainHost('co.uk', createApiConfig())).toThrow(
      'Custom domain must include a registrable domain, not only a public suffix.',
    );
    expect((): string => normalizeCustomDomainHost('github.io', createApiConfig())).toThrow(
      'Custom domain must include a registrable domain, not only a public suffix.',
    );
  });

  it('keeps valid public-suffix apex and subdomain hosts registrable', (): void => {
    expect(normalizeCustomDomainHost('example.co.uk', createApiConfig())).toBe('example.co.uk');
    expect(normalizeCustomDomainHost('app.customer.example.com', createApiConfig())).toBe('app.customer.example.com');
  });

  it('rejects special-use and unknown suffix hosts', (): void => {
    expect((): string => normalizeCustomDomainHost('foo.local', createApiConfig())).toThrow(
      'Custom domain must include a registrable domain, not only a public suffix.',
    );
    expect((): string => normalizeCustomDomainHost('foo.internal', createApiConfig())).toThrow(
      'Custom domain must include a registrable domain, not only a public suffix.',
    );
    expect((): string => normalizeCustomDomainHost('foo.invalid', createApiConfig())).toThrow(
      'Custom domain must include a registrable domain, not only a public suffix.',
    );
    expect((): string => normalizeCustomDomainHost('app.customer.test', createApiConfig())).toThrow(
      'Custom domain must include a registrable domain, not only a public suffix.',
    );
  });

  it('rejects private-suffix hosts that are not operator-owned zones', (): void => {
    expect((): string => normalizeCustomDomainHost('foo.github.io', createApiConfig())).toThrow(
      'Custom domain must include a registrable domain, not only a public suffix.',
    );
    expect((): string => normalizeCustomDomainHost('foo.pages.dev', createApiConfig())).toThrow(
      'Custom domain must include a registrable domain, not only a public suffix.',
    );
    expect((): string => normalizeCustomDomainHost('foo.s3.amazonaws.com', createApiConfig())).toThrow(
      'Custom domain must include a registrable domain, not only a public suffix.',
    );
  });

  it('rejects URL-like host input before IDNA normalization', (): void => {
    expect((): string => normalizeCustomDomainHost('app.example.com/path', createApiConfig())).toThrow(
      'Custom domain must be a valid non-local DNS hostname.',
    );
    expect((): string => normalizeCustomDomainHost('app.example.com?x=1', createApiConfig())).toThrow(
      'Custom domain must be a valid non-local DNS hostname.',
    );
    expect((): string => normalizeCustomDomainHost('app.example.com#section', createApiConfig())).toThrow(
      'Custom domain must be a valid non-local DNS hostname.',
    );
  });

  it('rejects hosts equal to or under the active compartment domains', (): void => {
    expect((): string => normalizeCustomDomainHost('example.compartment.run', createApiConfig())).toThrow(
      'Custom domain must not be under the active compartment base domain.',
    );
    expect((): string => normalizeCustomDomainHost('app.example.compartment.run', createApiConfig())).toThrow(
      'Custom domain must not be under the active compartment base domain.',
    );
    expect((): string => normalizeCustomDomainHost('console.example.compartment.run', createApiConfig())).toThrow(
      'Custom domain must not be under the active compartment base domain.',
    );
  });

  it('rejects runtime preconditions that cannot support custom domains', (): void => {
    const invalidPortConfig: ApiConfig = {
      ...createApiConfig(),
      publicHttpsPort: 8443,
    };
    configureValidationRuntime(invalidPortConfig);
    expect((): void => assertRuntimeSupportsCustomDomains(invalidPortConfig, createPublicIngressConfig())).toThrow(
      'Custom domains require public HTTPS on port 443.',
    );

    const missingIngressConfig: ApiPublicIngressConfig = {
      publicIngressIpv4: null,
      publicIngressIpv6: null,
    };
    configureValidationRuntime(createApiConfig());
    expect((): void => assertRuntimeSupportsCustomDomains(createApiConfig(), missingIngressConfig)).toThrow(
      'Managed custom app domains require a public ingress IPv4 or IPv6 address.',
    );

    const unsupportedRuntimeConfig: ApiConfig = {
      ...createApiConfig(),
      baseDomain: 'customer.example.com',
      caddyTlsMode: 'custom-http',
      customTlsDirectory: '/etc/compartment/tls',
    };
    configureValidationRuntime(unsupportedRuntimeConfig);
    expect((): void =>
      assertRuntimeSupportsCustomDomains(unsupportedRuntimeConfig, createPublicIngressConfig()),
    ).toThrow('Custom app domains require a managed or custom-cert system domain.');
  });

  it('allows supported managed and custom-cert runtime plans', (): void => {
    const managedConfig: ApiConfig = createApiConfig();
    configureValidationRuntime(managedConfig);
    expect((): void => assertRuntimeSupportsCustomDomains(managedConfig, createPublicIngressConfig())).not.toThrow();

    const customCertConfig: ApiConfig = {
      ...createApiConfig(),
      baseDomain: 'customer.example.com',
      caddyTlsMode: 'custom-cert',
      customTlsDirectory: '/etc/compartment/tls',
      controlPlaneHost: 'console.customer.example.com',
    };
    configureValidationRuntime(customCertConfig);
    expect((): void =>
      assertRuntimeSupportsCustomDomains(customCertConfig, createEmptyPublicIngressConfig()),
    ).not.toThrow();
  });
});

function configureValidationRuntime(config: ApiConfig): void {
  configureApiRuntime({
    config,
    db: {} as Database,
  });
}

function createApiConfig(): ApiConfig {
  return {
    baseDomain: 'example.compartment.run',
    bindHost: '127.0.0.1',
    caddyTlsMode: 'managed',
    customTlsDirectory: '/etc/compartment/tls',
    controlPlaneHost: 'console.example.compartment.run',
    databaseUrl: 'postgresql://postgres:postgres@127.0.0.1:5432/compartment_test',
    edgeToken: 'edge-token',
    edgeUrl: 'http://127.0.0.1:9081',
    logLevel: 'silent',
    port: 9443,
    publicHttpPort: 80,
    publicHttpsPort: 443,
    publicProtocol: 'https',
    auditRetentionDays: 90,
    auditRetentionCleanupBatchSize: 1000,
    auditRetentionCleanupCron: '0 3 * * *',
    auditRetentionCleanupMaxBatches: 100,
    auditFileSink: defaultAuditFileSinkConfig,
    rollbackRetentionLimit: null,
    runtimeControlToken: 'runtime-token',
    sessionSecret: 'test-session-secret',
    sessionTtlMs: 604_800_000,
    sourceArchiveDirectory: '/tmp/source-archives',
    sourceArchiveMaxBytes: 104_857_600,
    throttle: defaultApiAuthThrottleConfig,
    systemApiSocketPath: '/tmp/compartment/system-api.sock',
    systemToken: 'system-token',
    trustedOutboundHosts: [],
    variablesMasterKey: Buffer.from('11'.repeat(32), 'hex'),
  };
}

function createPublicIngressConfig(): ApiPublicIngressConfig {
  return {
    publicIngressIpv4: '203.0.113.10',
    publicIngressIpv6: '2001:db8::10',
  };
}

function createEmptyPublicIngressConfig(): ApiPublicIngressConfig {
  return {
    publicIngressIpv4: null,
    publicIngressIpv6: null,
  };
}
