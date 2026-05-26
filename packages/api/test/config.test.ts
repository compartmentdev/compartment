import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { readApiConfig, type ApiConfig } from '../src/config';

const requiredExplicitSelfHostedEnvSlots: string[] = [
  'COMPARTMENT_ROLLBACK_RETENTION_LIMIT',
  'COMPARTMENT_MANAGED_DOMAIN_BROKER_TOKEN',
  'COMPARTMENT_MANAGED_DOMAIN_BROKER_URL',
  'COMPARTMENT_TRUSTED_OUTBOUND_HOSTS',
];

describe('readApiConfig', (): void => {
  it('reads the required API runtime config from env', (): void => {
    const config: ApiConfig = readApiConfig(createApiConfigEnv());

    expect(config.baseDomain).toBe('localhost');
    expect(config.auditRetentionDays).toBe(90);
    expect(config.auditRetentionCleanupBatchSize).toBe(1000);
    expect(config.auditRetentionCleanupCron).toBe('0 3 * * *');
    expect(config.auditRetentionCleanupMaxBatches).toBe(100);
    expect(config.auditFileSink).toEqual({
      directory: resolve('.compartment/audit-logs'),
      enabled: false,
      retentionFiles: 30,
      rotateInterval: '1d',
      rotateSize: '64M',
    });
    expect(config.bindHost).toBe('127.0.0.1');
    expect(config.caddyTlsMode).toBe('internal');
    expect(config.controlPlaneHost).toBe('console.localhost');
    expect(config.edgeToken).toBe('edge-secret');
    expect(config.edgeUrl).toBe('http://127.0.0.1:9081');
    expect(config.managedDomainBrokerToken).toBeNull();
    expect(config.managedDomainBrokerUrl).toBeNull();
    expect(config.nodeAgentSocketPath).toBe('/tmp/compartment/node/agent.sock');
    expect(config.publicProtocol).toBe('http');
    expect(config.publicHttpPort).toBe(9080);
    expect(config.publicHttpsPort).toBe(9444);
    expect(config.customTlsDirectory).toBe('/etc/compartment/tls');
    expect(config.runtimeDefaultUpstreamHost).toBe('127.0.0.1');
    expect(config.resourceBackupDirectory).toBe('/tmp/compartment/dev/resource-backups');
    expect(config.sessionTtlMs).toBe(7 * 24 * 60 * 60 * 1000);
    expect(config.sourceArchiveDirectory).toBe('.compartment/source-archives');
    expect(config.sourceArchiveMaxBytes).toBe(104_857_600);
    expect(config.systemApiSocketPath).toBe('/tmp/compartment/api/system-api.sock');
    expect(config.systemToken).toBe('system-secret');
    expect(config.throttle).toEqual(defaultApiAuthThrottleConfig);
    expect(config.trustedOutboundHosts).toEqual([]);
    expect(config.variablesMasterKey).toEqual(Buffer.from('11'.repeat(32), 'hex'));
    expect(config.runtimeControlToken).toBe('runtime-control-secret');
  });

  it('rejects missing required runtime env values instead of silently falling back', (): void => {
    expect((): ApiConfig => {
      return readApiConfig({
        COMPARTMENT_BASE_DOMAIN: 'localhost',
        COMPARTMENT_CADDY_TLS_MODE: 'internal',
        COMPARTMENT_DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/compartment_dev',
        COMPARTMENT_EDGE_PORT: '9081',
        COMPARTMENT_LOG_LEVEL: 'info',
        COMPARTMENT_SESSION_SECRET: 'test-secret',
        COMPARTMENT_SESSION_TTL: '7d',
        COMPARTMENT_SOURCE_ARCHIVE_DIR: '.compartment/source-archives',
        COMPARTMENT_SOURCE_ARCHIVE_MAX_BYTES: '104857600',
        COMPARTMENT_RUNTIME_DEFAULT_UPSTREAM_HOST: '127.0.0.1',
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

    expect(config.managedDomainBrokerToken).toBe('broker-token');
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
            COMPARTMENT_CADDY_TLS_MODE: 'managed',
            COMPARTMENT_PUBLIC_PROTOCOL: 'https',
          }),
        ),
    ).toThrow(
      'COMPARTMENT_MANAGED_DOMAIN_BROKER_URL and COMPARTMENT_MANAGED_DOMAIN_BROKER_TOKEN are required when COMPARTMENT_CADDY_TLS_MODE is managed.',
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

  it('rejects a non-canonical variables master key length', (): void => {
    expect(
      (): ApiConfig => readApiConfig(createApiConfigEnv({ COMPARTMENT_VARIABLES_MASTER_KEY: `${'11'.repeat(32)}a` })),
    ).toThrow('COMPARTMENT_VARIABLES_MASTER_KEY must be exactly 64 hex characters.');
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

  it('rejects a relative custom TLS directory', (): void => {
    expect((): ApiConfig => readApiConfig(createApiConfigEnv({ COMPARTMENT_CUSTOM_TLS_DIR: 'tls' }))).toThrow(
      'COMPARTMENT_CUSTOM_TLS_DIR must be an absolute path.',
    );
  });

  it('preserves an absolute self-hosted resource backup directory', (): void => {
    const config: ApiConfig = readApiConfig(
      createApiConfigEnv({ COMPARTMENT_RESOURCE_BACKUP_DIR: '/var/lib/compartment/resource-backups' }),
    );

    expect(config.resourceBackupDirectory).toBe('/var/lib/compartment/resource-backups');
  });

  it('rejects a relative resource backup directory', (): void => {
    expect((): ApiConfig => {
      return readApiConfig(createApiConfigEnv({ COMPARTMENT_RESOURCE_BACKUP_DIR: '.compartment/resource-backups' }));
    }).toThrow('COMPARTMENT_RESOURCE_BACKUP_DIR must be an absolute path.');
  });

  it('rejects a system API socket path directly under a shared temp root', (): void => {
    expect((): ApiConfig => {
      return readApiConfig(createApiConfigEnv({ COMPARTMENT_SYSTEM_API_SOCKET: join(tmpdir(), 'system-api.sock') }));
    }).toThrow(
      'COMPARTMENT_SYSTEM_API_SOCKET must point to a socket inside a private subdirectory like /tmp/compartment/dev/api/system-api.sock or /var/run/compartment/api/system-api.sock.',
    );
  });

  it('rejects a relative node agent socket path', (): void => {
    expect((): ApiConfig => {
      return readApiConfig(createApiConfigEnv({ COMPARTMENT_NODE_AGENT_SOCKET: 'compartment/node/agent.sock' }));
    }).toThrow('COMPARTMENT_NODE_AGENT_SOCKET must be an absolute socket path.');
  });

  it('rejects a node agent socket path directly under a shared temp root', (): void => {
    expect((): ApiConfig => {
      return readApiConfig(createApiConfigEnv({ COMPARTMENT_NODE_AGENT_SOCKET: join(tmpdir(), 'agent.sock') }));
    }).toThrow(
      'COMPARTMENT_NODE_AGENT_SOCKET must point to a socket inside a private subdirectory like /tmp/compartment/dev/node/agent.sock or /var/run/compartment/node/agent.sock.',
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
    COMPARTMENT_AUDIT_RETENTION_CLEANUP_BATCH_SIZE: '1000',
    COMPARTMENT_AUDIT_RETENTION_CLEANUP_CRON: '0 3 * * *',
    COMPARTMENT_AUDIT_RETENTION_CLEANUP_MAX_BATCHES: '100',
    COMPARTMENT_API_PORT: '9443',
    COMPARTMENT_BASE_DOMAIN: 'localhost',
    COMPARTMENT_CADDY_TLS_MODE: 'internal',
    COMPARTMENT_CUSTOM_TLS_DIR: '/etc/compartment/tls',
    COMPARTMENT_DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/compartment_dev',
    COMPARTMENT_EDGE_INTERNAL_HOST: '127.0.0.1',
    COMPARTMENT_EDGE_PORT: '9081',
    COMPARTMENT_EDGE_TOKEN: 'edge-secret',
    COMPARTMENT_LOG_LEVEL: 'info',
    COMPARTMENT_MANAGED_DOMAIN_BROKER_TOKEN: '',
    COMPARTMENT_MANAGED_DOMAIN_BROKER_URL: '',
    COMPARTMENT_NODE_AGENT_SOCKET: '/tmp/compartment/node/agent.sock',
    COMPARTMENT_PUBLIC_PROTOCOL: 'http',
    COMPARTMENT_PUBLIC_HTTP_PORT: '9080',
    COMPARTMENT_PUBLIC_HTTPS_PORT: '9444',
    COMPARTMENT_SESSION_SECRET: 'test-secret',
    COMPARTMENT_SESSION_TTL: '7d',
    COMPARTMENT_SYSTEM_API_SOCKET: '/tmp/compartment/api/system-api.sock',
    COMPARTMENT_SYSTEM_TOKEN: 'system-secret',
    COMPARTMENT_TRUSTED_OUTBOUND_HOSTS: '',
    COMPARTMENT_RESOURCE_BACKUP_DIR: '/tmp/compartment/dev/resource-backups',
    COMPARTMENT_ROLLBACK_RETENTION_LIMIT: '',
    COMPARTMENT_SOURCE_ARCHIVE_DIR: '.compartment/source-archives',
    COMPARTMENT_SOURCE_ARCHIVE_MAX_BYTES: '104857600',
    COMPARTMENT_RUNTIME_DEFAULT_UPSTREAM_HOST: '127.0.0.1',
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
    COMPARTMENT_VARIABLES_MASTER_KEY: '11'.repeat(32),
    COMPARTMENT_RUNTIME_CONTROL_TOKEN: 'runtime-control-secret',
    ...overrides,
  };
}
