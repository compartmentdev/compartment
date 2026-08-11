import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { readApiConfig, readApiInstallToken, type ApiConfig } from '../src/config';

const requiredExplicitSelfHostedEnvSlots: string[] = [
  'COMPARTMENT_ROLLBACK_RETENTION_LIMIT',
  'COMPARTMENT_MANAGED_DOMAIN_BROKER_TOKEN',
  'COMPARTMENT_MANAGED_DOMAIN_BROKER_URL',
  'COMPARTMENT_TRUSTED_OUTBOUND_HOSTS',
];
const generated24ByteSecret: string = '0123456789abcdef0123456789abcdef0123456789abcdef';
const generated32ByteSecret: string = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('readApiConfig', (): void => {
  it('reads the required API runtime config from env', (): void => {
    const config: ApiConfig = readApiConfig(createApiConfigEnv());

    expect(config.baseDomain).toBe('localhost');
    expect(config.auditRetentionDays).toBe(90);
    expect(config.auditRetentionCleanupBatchSize).toBe(1000);
    expect(config.auditRetentionCleanupCron).toBe('0 3 * * *');
    expect(config.auditRetentionCleanupMaxBatches).toBe(100);
    expect(config.usageMeteringIntervalMs).toBe(60_000);
    expect(config.usageRetentionDays).toBe(400);
    expect(config.auditFileSink).toEqual({
      directory: resolve('.compartment/audit-logs'),
      enabled: false,
      retentionFiles: 30,
      rotateInterval: '1d',
      rotateSize: '64M',
    });
    expect(config.bindHost).toBe('127.0.0.1');
    expect(config.tlsMode).toBe('internal');
    expect(config.controlPlaneHost).toBe('console.localhost');
    expect(config.edgeToken).toBe('edge-secret');
    expect(config.edgeUrl).toBe('http://127.0.0.1:9081');
    expect(config.managedDomainAcmeDnsToken).toBeNull();
    expect(config.managedDomainBrokerUrl).toBeNull();
    expect(config.newProjectsPrivateByDefault).toBe(true);
    expect(config.publicProtocol).toBe('http');
    expect(config.publicHttpPort).toBe(9080);
    expect(config.publicHttpsPort).toBe(9444);
    expect(config.productLogIngestToken).toBeNull();
    expect(config.sessionTtlMs).toBe(7 * 24 * 60 * 60 * 1000);
    expect(config.sourceArchiveDirectory).toBe('.compartment/source-archives');
    expect(config.sourceArchiveMaxBytes).toBe(104_857_600);
    expect(config.systemApiSocketPath).toBe('/tmp/compartment/api/system-api.sock');
    expect(config.systemToken).toBe('system-secret');
    expect(config.throttle).toEqual(defaultApiAuthThrottleConfig);
    expect(config.trustedOutboundHosts).toEqual([]);
    expect(config.tenantSecretsKek).toEqual(Buffer.from('22'.repeat(32), 'hex'));
    expect(config.variablesMasterKey).toEqual(Buffer.from('11'.repeat(32), 'hex'));
    expect(config.runtimeControlToken).toBe('runtime-control-secret');
  });

  it('strictly reads the new-project privacy setting', (): void => {
    expect(
      readApiConfig(createApiConfigEnv({ COMPARTMENT_NEW_PROJECTS_PRIVATE_BY_DEFAULT: 'false' }))
        .newProjectsPrivateByDefault,
    ).toBe(false);
    expect(
      (): ApiConfig => readApiConfig(createApiConfigEnv({ COMPARTMENT_NEW_PROJECTS_PRIVATE_BY_DEFAULT: 'TRUE' })),
    ).toThrow('COMPARTMENT_NEW_PROJECTS_PRIVATE_BY_DEFAULT must be true or false.');
    expect(
      (): ApiConfig => readApiConfig(createApiConfigEnv({ COMPARTMENT_NEW_PROJECTS_PRIVATE_BY_DEFAULT: undefined })),
    ).toThrow();
  });

  it('reads the owner bootstrap token as a required app boundary secret', (): void => {
    expect(readApiInstallToken(createApiConfigEnv())).toBe('install-secret');
    expect((): string => readApiInstallToken(createApiConfigEnv({ COMPARTMENT_INSTALL_TOKEN: undefined }))).toThrow();
  });

  it('rejects missing required runtime env values instead of silently falling back', (): void => {
    expect((): ApiConfig => {
      return readApiConfig({
        COMPARTMENT_BASE_DOMAIN: 'localhost',
        COMPARTMENT_TLS_MODE: 'internal',
        COMPARTMENT_DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/compartment_dev',
        COMPARTMENT_EDGE_PORT: '9081',
        COMPARTMENT_LOG_LEVEL: 'info',
        COMPARTMENT_SESSION_SECRET: 'test-secret',
        COMPARTMENT_SESSION_TTL: '7d',
        COMPARTMENT_SOURCE_ARCHIVE_DIR: '.compartment/source-archives',
        COMPARTMENT_SOURCE_ARCHIVE_MAX_BYTES: '104857600',
        COMPARTMENT_VARIABLES_MASTER_KEY: '11'.repeat(32),
        COMPARTMENT_RUNTIME_CONTROL_TOKEN: 'runtime-control-secret',
      });
    }).toThrow();
  });

  for (const variableName of requiredExplicitSelfHostedEnvSlots) {
    it(`requires an explicit value for ${variableName}`, (): void => {
      expect((): ApiConfig => readApiConfig(createApiConfigEnv({ [variableName]: undefined }))).toThrow();
    });
  }

  it('rejects an invalid session ttl duration', (): void => {
    expect((): ApiConfig => readApiConfig(createApiConfigEnv({ COMPARTMENT_SESSION_TTL: 'banana' }))).toThrow(
      'COMPARTMENT_SESSION_TTL must be a positive duration like 30m, 24h, or 7d.',
    );
  });

  it('reads complete managed domain broker config', (): void => {
    const config: ApiConfig = readApiConfig(
      createApiConfigEnv({
        COMPARTMENT_MANAGED_DOMAIN_BROKER_TOKEN: 'broker-token',
        COMPARTMENT_MANAGED_DOMAIN_BROKER_URL: 'https://broker.compartment.run',
      }),
    );

    expect(config.managedDomainAcmeDnsToken).toBe('broker-token');
    expect(config.managedDomainBrokerUrl).toBe('https://broker.compartment.run/');
  });

  it('rejects partial managed domain broker config', (): void => {
    expect(
      (): ApiConfig =>
        readApiConfig(
          createApiConfigEnv({
            COMPARTMENT_MANAGED_DOMAIN_BROKER_URL: 'https://broker.compartment.run',
          }),
        ),
    ).toThrow(
      'COMPARTMENT_MANAGED_DOMAIN_BROKER_URL and COMPARTMENT_MANAGED_DOMAIN_BROKER_TOKEN must be configured together.',
    );
    expect(
      (): ApiConfig =>
        readApiConfig(
          createApiConfigEnv({
            COMPARTMENT_MANAGED_DOMAIN_BROKER_TOKEN: 'broker-token',
          }),
        ),
    ).toThrow(
      'COMPARTMENT_MANAGED_DOMAIN_BROKER_URL and COMPARTMENT_MANAGED_DOMAIN_BROKER_TOKEN must be configured together.',
    );
  });

  it('requires managed domain broker config for managed TLS mode', (): void => {
    expect(
      (): ApiConfig =>
        readApiConfig(
          createApiConfigEnv({
            COMPARTMENT_TLS_MODE: 'broker-dns01',
            COMPARTMENT_PUBLIC_PROTOCOL: 'https',
          }),
        ),
    ).toThrow(
      'COMPARTMENT_MANAGED_DOMAIN_BROKER_URL and COMPARTMENT_MANAGED_DOMAIN_BROKER_TOKEN are required when COMPARTMENT_TLS_MODE is broker-dns01.',
    );
  });

  it('rejects invalid managed domain broker URLs', (): void => {
    expect(
      (): ApiConfig =>
        readApiConfig(
          createApiConfigEnv({
            COMPARTMENT_MANAGED_DOMAIN_BROKER_TOKEN: 'broker-token',
            COMPARTMENT_MANAGED_DOMAIN_BROKER_URL: 'ftp://broker.compartment.run',
          }),
        ),
    ).toThrow('COMPARTMENT_MANAGED_DOMAIN_BROKER_URL must be empty or an absolute HTTP(S) URL.');
  });

  it('reads trusted outbound hosts as canonical host entries', (): void => {
    const config: ApiConfig = readApiConfig(
      createApiConfigEnv({
        COMPARTMENT_TRUSTED_OUTBOUND_HOSTS:
          'GitHub.Enterprise.Example, idp.example.com:8443,github.enterprise.example,login.example.com:443',
      }),
    );

    expect(config.trustedOutboundHosts).toEqual([
      'github.enterprise.example',
      'idp.example.com:8443',
      'login.example.com',
    ]);
  });

  it('rejects trusted outbound host URLs and unsafe IP literals', (): void => {
    expect(
      (): ApiConfig =>
        readApiConfig(
          createApiConfigEnv({
            COMPARTMENT_TRUSTED_OUTBOUND_HOSTS: 'https://idp.example.com',
          }),
        ),
    ).toThrow('COMPARTMENT_TRUSTED_OUTBOUND_HOSTS must be empty or a comma-separated list');

    expect(
      (): ApiConfig =>
        readApiConfig(
          createApiConfigEnv({
            COMPARTMENT_TRUSTED_OUTBOUND_HOSTS: ['169', '254', '169', '254'].join('.'),
          }),
        ),
    ).toThrow('COMPARTMENT_TRUSTED_OUTBOUND_HOSTS must be empty or a comma-separated list');
  });

  it('rejects an invalid auth throttle duration', (): void => {
    expect(
      (): ApiConfig =>
        readApiConfig(createApiConfigEnv({ COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_WINDOW: 'banana' })),
    ).toThrow(
      'COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_WINDOW must be a positive duration like 30m, 24h, or 7d.',
    );
  });

  it('rejects a missing reset password throttle env value', (): void => {
    expect(
      (): ApiConfig =>
        readApiConfig(createApiConfigEnv({ COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_ROUTE_MAX_REQUESTS: undefined })),
    ).toThrow();
  });

  it('rejects an invalid variables master key', (): void => {
    expect((): ApiConfig => readApiConfig(createApiConfigEnv({ COMPARTMENT_VARIABLES_MASTER_KEY: 'not-hex' }))).toThrow(
      'COMPARTMENT_VARIABLES_MASTER_KEY must be exactly 64 hex characters.',
    );
  });

  it('requires a canonical tenant secrets KEK', (): void => {
    expect((): ApiConfig => readApiConfig(createApiConfigEnv({ COMPARTMENT_TENANT_SECRETS_KEK: undefined }))).toThrow();
    expect((): ApiConfig => readApiConfig(createApiConfigEnv({ COMPARTMENT_TENANT_SECRETS_KEK: 'not-hex' }))).toThrow(
      'COMPARTMENT_TENANT_SECRETS_KEK must be exactly 64 hex characters.',
    );
  });

  it('rejects a non-canonical variables master key length', (): void => {
    expect(
      (): ApiConfig => readApiConfig(createApiConfigEnv({ COMPARTMENT_VARIABLES_MASTER_KEY: `${'11'.repeat(32)}a` })),
    ).toThrow('COMPARTMENT_VARIABLES_MASTER_KEY must be exactly 64 hex characters.');
  });

  it('accepts generated self-hosted secret env values', (): void => {
    const config: ApiConfig = readApiConfig(createSelfHostedApiConfigEnv());

    expect(config.sessionSecret).toBe(generated32ByteSecret);
    expect(config.variablesMasterKey).toEqual(Buffer.from(generated32ByteSecret, 'hex'));
  });

  it('rejects self-hosted example-style secret env values by shape', (): void => {
    expect(
      (): ApiConfig =>
        readApiConfig(
          createSelfHostedApiConfigEnv({
            COMPARTMENT_DATABASE_URL: 'postgresql://postgres:postgres@postgres:5432/compartment',
            COMPARTMENT_POSTGRES_PASSWORD: 'postgres',
            COMPARTMENT_SESSION_SECRET: 'change-me',
          }),
        ),
    ).toThrow('COMPARTMENT_POSTGRES_PASSWORD must be at least 48 hex characters for self-hosted environments.');
  });

  it('rejects low-entropy self-hosted variables master keys', (): void => {
    expect(
      (): ApiConfig =>
        readApiConfig(
          createSelfHostedApiConfigEnv({
            COMPARTMENT_VARIABLES_MASTER_KEY: '1'.repeat(64),
          }),
        ),
    ).toThrow('COMPARTMENT_VARIABLES_MASTER_KEY must not use one repeated hex character for self-hosted environments.');
  });

  it('allows local dev database defaults when the runtime env is not self-hosted', (): void => {
    expect(
      (): ApiConfig =>
        readApiConfig(
          createApiConfigEnv({
            COMPARTMENT_DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/compartment_test',
            COMPARTMENT_ENV: 'dev',
            COMPARTMENT_POSTGRES_PASSWORD: 'postgres',
            COMPARTMENT_VARIABLES_MASTER_KEY: '1'.repeat(64),
          }),
        ),
    ).not.toThrow();
  });

  it('rejects a non-positive source archive limit', (): void => {
    expect((): ApiConfig => readApiConfig(createApiConfigEnv({ COMPARTMENT_SOURCE_ARCHIVE_MAX_BYTES: '0' }))).toThrow();
  });

  it('rejects an invalid audit retention cleanup cron', (): void => {
    expect(
      (): ApiConfig => readApiConfig(createApiConfigEnv({ COMPARTMENT_AUDIT_RETENTION_CLEANUP_CRON: 'banana' })),
    ).toThrow('COMPARTMENT_AUDIT_RETENTION_CLEANUP_CRON must be a valid cron expression.');
  });

  it('rejects a non-positive audit retention cleanup batch size', (): void => {
    expect(
      (): ApiConfig => readApiConfig(createApiConfigEnv({ COMPARTMENT_AUDIT_RETENTION_CLEANUP_BATCH_SIZE: '0' })),
    ).toThrow();
  });

  it('rejects a non-positive audit retention cleanup max batches value', (): void => {
    expect(
      (): ApiConfig => readApiConfig(createApiConfigEnv({ COMPARTMENT_AUDIT_RETENTION_CLEANUP_MAX_BATCHES: '0' })),
    ).toThrow();
  });

  it('rejects an invalid audit file sink enabled value', (): void => {
    expect((): ApiConfig => readApiConfig(createApiConfigEnv({ COMPARTMENT_AUDIT_FILE_SINK_ENABLED: 'yes' }))).toThrow(
      'COMPARTMENT_AUDIT_FILE_SINK_ENABLED must be true or false.',
    );
  });

  it('rejects an invalid audit file sink rotation interval', (): void => {
    expect(
      (): ApiConfig => readApiConfig(createApiConfigEnv({ COMPARTMENT_AUDIT_FILE_SINK_ROTATE_INTERVAL: '7w' })),
    ).toThrow('COMPARTMENT_AUDIT_FILE_SINK_ROTATE_INTERVAL must be a rotating-file-stream interval');
  });

  it('rejects an invalid audit file sink rotation size', (): void => {
    expect(
      (): ApiConfig => readApiConfig(createApiConfigEnv({ COMPARTMENT_AUDIT_FILE_SINK_ROTATE_SIZE: '64MB' })),
    ).toThrow('COMPARTMENT_AUDIT_FILE_SINK_ROTATE_SIZE must be a rotating-file-stream size like 64M.');
  });

  it('rejects a non-positive audit file sink retention file count', (): void => {
    expect(
      (): ApiConfig => readApiConfig(createApiConfigEnv({ COMPARTMENT_AUDIT_FILE_SINK_RETENTION_FILES: '0' })),
    ).toThrow();
  });

  it('rejects a system API socket path directly under a shared temp root', (): void => {
    expect((): ApiConfig => {
      return readApiConfig(createApiConfigEnv({ COMPARTMENT_SYSTEM_API_SOCKET: join(tmpdir(), 'system-api.sock') }));
    }).toThrow(
      'COMPARTMENT_SYSTEM_API_SOCKET must point to a socket inside a private subdirectory like /tmp/compartment/dev/api/system-api.sock or /var/run/compartment/api/system-api.sock.',
    );
  });
});

function createApiConfigEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return {
    COMPARTMENT_API_BIND_HOST: '127.0.0.1',
    COMPARTMENT_AUDIT_FILE_SINK_DIR: '.compartment/audit-logs',
    COMPARTMENT_AUDIT_FILE_SINK_ENABLED: 'false',
    COMPARTMENT_AUDIT_FILE_SINK_RETENTION_FILES: '30',
    COMPARTMENT_AUDIT_FILE_SINK_ROTATE_INTERVAL: '1d',
    COMPARTMENT_AUDIT_FILE_SINK_ROTATE_SIZE: '64M',
    COMPARTMENT_AUDIT_RETENTION_DAYS: '90',
    COMPARTMENT_USAGE_METERING_INTERVAL_MS: '60000',
    COMPARTMENT_USAGE_RETENTION_DAYS: '400',
    COMPARTMENT_AUDIT_RETENTION_CLEANUP_BATCH_SIZE: '1000',
    COMPARTMENT_AUDIT_RETENTION_CLEANUP_CRON: '0 3 * * *',
    COMPARTMENT_AUDIT_RETENTION_CLEANUP_MAX_BATCHES: '100',
    COMPARTMENT_API_PORT: '9443',
    COMPARTMENT_BASE_DOMAIN: 'localhost',
    COMPARTMENT_TLS_MODE: 'internal',
    COMPARTMENT_DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/compartment_dev',
    COMPARTMENT_EDGE_INTERNAL_HOST: '127.0.0.1',
    COMPARTMENT_EDGE_PORT: '9081',
    COMPARTMENT_EDGE_TOKEN: 'edge-secret',
    COMPARTMENT_ENV: 'dev',
    COMPARTMENT_LOG_LEVEL: 'info',
    COMPARTMENT_NEW_PROJECTS_PRIVATE_BY_DEFAULT: 'true',
    COMPARTMENT_INSTALL_TOKEN: 'install-secret',
    COMPARTMENT_MANAGED_DOMAIN_BROKER_TOKEN: '',
    COMPARTMENT_MANAGED_DOMAIN_BROKER_URL: '',
    COMPARTMENT_POSTGRES_PASSWORD: 'postgres',
    COMPARTMENT_PUBLIC_PROTOCOL: 'http',
    COMPARTMENT_PUBLIC_HTTP_PORT: '9080',
    COMPARTMENT_PUBLIC_HTTPS_PORT: '9444',
    COMPARTMENT_SESSION_SECRET: 'test-secret',
    COMPARTMENT_SESSION_TTL: '7d',
    COMPARTMENT_SIGNUP_ENABLED: 'false',
    COMPARTMENT_SYSTEM_API_SOCKET: '/tmp/compartment/api/system-api.sock',
    COMPARTMENT_SYSTEM_TOKEN: 'system-secret',
    COMPARTMENT_TRUSTED_OUTBOUND_HOSTS: '',
    COMPARTMENT_ROLLBACK_RETENTION_LIMIT: '',
    COMPARTMENT_SOURCE_ARCHIVE_DIR: '.compartment/source-archives',
    COMPARTMENT_SOURCE_ARCHIVE_MAX_BYTES: '104857600',
    COMPARTMENT_THROTTLE_AUTH_LOGIN_ROUTE_MAX_REQUESTS: '30',
    COMPARTMENT_THROTTLE_AUTH_LOGIN_ROUTE_WINDOW: '1m',
    COMPARTMENT_THROTTLE_AUTH_LOGIN_SOURCE_MAX_FAILURES: '20',
    COMPARTMENT_THROTTLE_AUTH_LOGIN_SOURCE_WINDOW: '5m',
    COMPARTMENT_THROTTLE_AUTH_LOGIN_SOURCE_BLOCK: '15m',
    COMPARTMENT_THROTTLE_AUTH_LOGIN_ACCOUNT_MAX_FAILURES: '10',
    COMPARTMENT_THROTTLE_AUTH_LOGIN_ACCOUNT_WINDOW: '10m',
    COMPARTMENT_THROTTLE_AUTH_LOGIN_ACCOUNT_BLOCK: '30m',
    COMPARTMENT_THROTTLE_AUTH_LOGIN_SOURCE_ACCOUNT_MAX_FAILURES: '5',
    COMPARTMENT_THROTTLE_AUTH_LOGIN_SOURCE_ACCOUNT_WINDOW: '1m',
    COMPARTMENT_THROTTLE_AUTH_LOGIN_SOURCE_ACCOUNT_BLOCK: '10m',
    COMPARTMENT_THROTTLE_AUTH_ACTIVATE_ROUTE_MAX_REQUESTS: '10',
    COMPARTMENT_THROTTLE_AUTH_ACTIVATE_ROUTE_WINDOW: '1m',
    COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SOURCE_MAX_FAILURES: '15',
    COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SOURCE_WINDOW: '10m',
    COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SOURCE_BLOCK: '30m',
    COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SUBJECT_MAX_FAILURES: '5',
    COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SUBJECT_WINDOW: '30m',
    COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SUBJECT_BLOCK: '60m',
    COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SOURCE_SUBJECT_MAX_FAILURES: '3',
    COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SOURCE_SUBJECT_WINDOW: '10m',
    COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SOURCE_SUBJECT_BLOCK: '30m',
    COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_ROUTE_MAX_REQUESTS: '10',
    COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_ROUTE_WINDOW: '1m',
    COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_MAX_FAILURES: '15',
    COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_WINDOW: '10m',
    COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_BLOCK: '30m',
    COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SUBJECT_MAX_FAILURES: '5',
    COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SUBJECT_WINDOW: '30m',
    COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SUBJECT_BLOCK: '60m',
    COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_SUBJECT_MAX_FAILURES: '3',
    COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_SUBJECT_WINDOW: '10m',
    COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_SUBJECT_BLOCK: '30m',
    COMPARTMENT_TENANT_SECRETS_KEK: '22'.repeat(32),
    COMPARTMENT_VARIABLES_MASTER_KEY: '11'.repeat(32),
    COMPARTMENT_RUNTIME_CONTROL_TOKEN: 'runtime-control-secret',
    ...overrides,
  };
}

function createSelfHostedApiConfigEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return createApiConfigEnv({
    COMPARTMENT_DATABASE_URL: `postgresql://postgres:${generated24ByteSecret}@postgres:5432/compartment`,
    COMPARTMENT_EDGE_TOKEN: generated24ByteSecret,
    COMPARTMENT_INSTALL_TOKEN: generated24ByteSecret,
    COMPARTMENT_ENV: 'self-hosted',
    COMPARTMENT_POSTGRES_PASSWORD: generated24ByteSecret,
    COMPARTMENT_RUNTIME_CONTROL_TOKEN: generated24ByteSecret,
    COMPARTMENT_SESSION_SECRET: generated32ByteSecret,
    COMPARTMENT_SYSTEM_TOKEN: generated24ByteSecret,
    COMPARTMENT_TENANT_SECRETS_KEK: generated32ByteSecret,
    COMPARTMENT_VARIABLES_MASTER_KEY: generated32ByteSecret,
    ...overrides,
  });
}
