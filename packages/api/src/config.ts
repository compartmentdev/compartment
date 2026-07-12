import { buildControlPlaneHost } from '@compartment/contracts';
import {
  assertValidUnixSocketPath,
  assertSelfHostedGeneratedSecretEnvironment,
  buildInternalHttpUrl,
  createCompartmentUnixSocketPathPolicy,
  parseOptionalTrustedOutboundHostList,
  readRequiredAbsolutePath,
  type UnixSocketPathPolicy,
} from '@compartment/utils';
import { z } from 'zod';
import {
  auditFileSinkConfigEnvSchema,
  readAuditFileSinkConfig,
  type AuditFileSinkConfig,
} from './audit-file-sink-config';
import { readApiAuthThrottleConfig, type ApiAuthThrottleConfig } from './auth-throttle-config';
import type { ApiConfigEnv } from './config-env.types';
import { parseOptionalAbsoluteUrl, parseOptionalPositiveInt, readRequiredCronExpression } from './config-parsers';
import { parseVariablesMasterKey } from './lib/variables-crypto';
import { normalizeApiHostValue, parseSessionTtl, readOptionalConfigText } from './config-value';
import { assertValidSystemApiSocketPath } from './system-api-socket-path';

export type { AuditFileSinkConfig } from './audit-file-sink-config';
export { readApiPublicIngressConfig, type ApiPublicIngressConfig } from './api-public-ingress-config';

const apiConfigSchema: z.ZodTypeAny = z.object({
  COMPARTMENT_API_BIND_HOST: z.string().min(1),
  COMPARTMENT_API_PORT: z.coerce.number().int().positive(),
  ...auditFileSinkConfigEnvSchema,
  COMPARTMENT_BASE_DOMAIN: z.string().min(1),
  COMPARTMENT_CADDY_TLS_MODE: z.enum(['managed', 'internal', 'custom-http', 'custom-cert']),
  COMPARTMENT_CUSTOM_TLS_DIR: z.string().min(1),
  COMPARTMENT_DATABASE_URL: z.string().min(1),
  COMPARTMENT_EDGE_INTERNAL_HOST: z.string().min(1),
  COMPARTMENT_EDGE_PORT: z.coerce.number().int().positive(),
  COMPARTMENT_EDGE_TOKEN: z.string().min(1),
  COMPARTMENT_ENV: z.enum(['dev', 'self-hosted']).optional(),
  COMPARTMENT_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),
  COMPARTMENT_MANAGED_DOMAIN_BROKER_TOKEN: z.string(),
  COMPARTMENT_MANAGED_DOMAIN_BROKER_URL: z.string(),
  COMPARTMENT_TRUSTED_OUTBOUND_HOSTS: z.string(),
  COMPARTMENT_NODE_AGENT_SOCKET: z.string().min(1),
  COMPARTMENT_PUBLIC_PROTOCOL: z.enum(['http', 'https']),
  COMPARTMENT_PUBLIC_HTTP_PORT: z.coerce.number().int().positive(),
  COMPARTMENT_PUBLIC_HTTPS_PORT: z.coerce.number().int().positive(),
  COMPARTMENT_POSTGRES_PASSWORD: z.string().optional(),
  COMPARTMENT_RUNTIME_DEFAULT_UPSTREAM_HOST: z.string().min(1),
  COMPARTMENT_AUDIT_RETENTION_DAYS: z.coerce.number().int().positive(),
  COMPARTMENT_AUDIT_RETENTION_CLEANUP_BATCH_SIZE: z.coerce.number().int().positive(),
  COMPARTMENT_AUDIT_RETENTION_CLEANUP_CRON: z.string().min(1),
  COMPARTMENT_AUDIT_RETENTION_CLEANUP_MAX_BATCHES: z.coerce.number().int().positive(),
  COMPARTMENT_ROLLBACK_RETENTION_LIMIT: z.string(),
  COMPARTMENT_RESOURCE_BACKUP_DIR: z.string().min(1),
  COMPARTMENT_SOURCE_ARCHIVE_DIR: z.string().min(1),
  COMPARTMENT_SOURCE_ARCHIVE_MAX_BYTES: z.coerce.number().int().positive(),
  COMPARTMENT_SESSION_SECRET: z.string().min(1),
  COMPARTMENT_SESSION_TTL: z.string().min(1),
  COMPARTMENT_SYSTEM_API_SOCKET: z.string().min(1),
  COMPARTMENT_SYSTEM_TOKEN: z.string().min(1),
  COMPARTMENT_VARIABLES_MASTER_KEY: z.string().min(1),
  COMPARTMENT_WORKER_IMAGE: z.string().min(1).optional(),
  COMPARTMENT_RUNTIME_CONTROL_TOKEN: z.string().min(1),
});

const nodeAgentSocketPolicy: UnixSocketPathPolicy = createCompartmentUnixSocketPathPolicy({
  directoryLabel: 'Node agent socket directory',
  socketFileName: 'agent.sock',
  socketSubdirectory: 'node',
  variableName: 'COMPARTMENT_NODE_AGENT_SOCKET',
});

export interface ApiConfig {
  auditFileSink: AuditFileSinkConfig;
  baseDomain: string;
  bindHost: string;
  caddyTlsMode: 'managed' | 'internal' | 'custom-http' | 'custom-cert';
  controlPlaneHost: string;
  customTlsDirectory: string;
  databaseUrl: string;
  edgeToken: string;
  edgeUrl: string;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  managedDomainBrokerToken?: string | null;
  managedDomainBrokerUrl?: string | null;
  trustedOutboundHosts: string[];
  nodeAgentSocketPath: string;
  sessionSecret: string;
  sessionTtlMs: number;
  port: number;
  publicProtocol: 'http' | 'https';
  publicHttpPort: number;
  publicHttpsPort: number;
  auditRetentionDays: number;
  auditRetentionCleanupBatchSize: number;
  auditRetentionCleanupCron: string;
  auditRetentionCleanupMaxBatches: number;
  rollbackRetentionLimit: number | null;
  runtimeDefaultUpstreamHost: string;
  resourceBackupDirectory: string;
  sourceArchiveDirectory: string;
  sourceArchiveMaxBytes: number;
  throttle: ApiAuthThrottleConfig;
  systemApiSocketPath: string;
  systemToken: string;
  variablesMasterKey: Buffer;
  runtimeControlToken: string;
  workerImageRef?: string | null;
}

type ApiCoreConfig = Pick<
  ApiConfig,
  'bindHost' | 'databaseUrl' | 'edgeToken' | 'logLevel' | 'port' | 'sessionSecret' | 'sessionTtlMs'
>;
type ApiHostConfig = Pick<ApiConfig, 'baseDomain' | 'caddyTlsMode' | 'controlPlaneHost' | 'edgeUrl'>;
type ApiIntegrationConfig = Pick<
  ApiConfig,
  'managedDomainBrokerToken' | 'managedDomainBrokerUrl' | 'trustedOutboundHosts'
>;
type ApiPublicConfig = Pick<ApiConfig, 'publicProtocol' | 'publicHttpPort' | 'publicHttpsPort'>;
type ApiRuntimeConfig = Pick<
  ApiConfig,
  | 'auditFileSink'
  | 'customTlsDirectory'
  | 'auditRetentionDays'
  | 'auditRetentionCleanupBatchSize'
  | 'auditRetentionCleanupCron'
  | 'auditRetentionCleanupMaxBatches'
  | 'rollbackRetentionLimit'
  | 'resourceBackupDirectory'
  | 'runtimeDefaultUpstreamHost'
  | 'sourceArchiveDirectory'
  | 'sourceArchiveMaxBytes'
  | 'workerImageRef'
>;
type ApiSecretConfig = Pick<
  ApiConfig,
  'nodeAgentSocketPath' | 'systemApiSocketPath' | 'systemToken' | 'variablesMasterKey' | 'runtimeControlToken'
>;

export function readApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed: ApiConfigEnv = apiConfigSchema.parse(env) as ApiConfigEnv;
  assertSelfHostedGeneratedSecretEnvironment(env, { requireArtifactRegistrySecrets: false });

  return {
    throttle: readApiAuthThrottleConfig(env),
    ...readApiHostConfig(parsed),
    ...readApiIntegrationConfig(parsed),
    ...readApiCoreConfig(parsed),
    ...readApiPublicConfig(parsed),
    ...readApiRuntimeConfig(parsed),
    ...readApiSecretConfig(parsed),
  };
}

function readApiHostConfig(parsed: ApiConfigEnv): ApiHostConfig {
  const baseDomain: string = normalizeApiHostValue(parsed.COMPARTMENT_BASE_DOMAIN);

  return {
    baseDomain,
    caddyTlsMode: parsed.COMPARTMENT_CADDY_TLS_MODE,
    controlPlaneHost: buildControlPlaneHost(baseDomain),
    edgeUrl: buildInternalHttpUrl(parsed.COMPARTMENT_EDGE_INTERNAL_HOST, parsed.COMPARTMENT_EDGE_PORT),
  };
}

function readApiIntegrationConfig(parsed: ApiConfigEnv): ApiIntegrationConfig {
  const managedDomainBrokerUrl: string | null = parseOptionalAbsoluteUrl(
    parsed.COMPARTMENT_MANAGED_DOMAIN_BROKER_URL,
    'COMPARTMENT_MANAGED_DOMAIN_BROKER_URL',
  );
  const managedDomainBrokerToken: string | null = readOptionalConfigText(
    parsed.COMPARTMENT_MANAGED_DOMAIN_BROKER_TOKEN,
  );
  if ((managedDomainBrokerUrl === null) !== (managedDomainBrokerToken === null)) {
    throw new Error(
      'COMPARTMENT_MANAGED_DOMAIN_BROKER_URL and COMPARTMENT_MANAGED_DOMAIN_BROKER_TOKEN must be configured together.',
    );
  }
  if (parsed.COMPARTMENT_CADDY_TLS_MODE === 'managed' && managedDomainBrokerUrl === null) {
    throw new Error(
      'COMPARTMENT_MANAGED_DOMAIN_BROKER_URL and COMPARTMENT_MANAGED_DOMAIN_BROKER_TOKEN are required when COMPARTMENT_CADDY_TLS_MODE is managed.',
    );
  }

  return {
    managedDomainBrokerToken,
    managedDomainBrokerUrl,
    trustedOutboundHosts: readTrustedOutboundHosts(parsed),
  };
}

function readTrustedOutboundHosts(parsed: ApiConfigEnv): string[] {
  return parseOptionalTrustedOutboundHostList(
    parsed.COMPARTMENT_TRUSTED_OUTBOUND_HOSTS,
    'COMPARTMENT_TRUSTED_OUTBOUND_HOSTS',
  );
}

function readApiCoreConfig(parsed: ApiConfigEnv): ApiCoreConfig {
  return {
    bindHost: parsed.COMPARTMENT_API_BIND_HOST,
    databaseUrl: parsed.COMPARTMENT_DATABASE_URL,
    edgeToken: parsed.COMPARTMENT_EDGE_TOKEN,
    logLevel: parsed.COMPARTMENT_LOG_LEVEL,
    port: parsed.COMPARTMENT_API_PORT,
    sessionSecret: parsed.COMPARTMENT_SESSION_SECRET,
    sessionTtlMs: parseSessionTtl(parsed.COMPARTMENT_SESSION_TTL),
  };
}

function readApiPublicConfig(parsed: ApiConfigEnv): ApiPublicConfig {
  return {
    publicProtocol: parsed.COMPARTMENT_PUBLIC_PROTOCOL,
    publicHttpPort: parsed.COMPARTMENT_PUBLIC_HTTP_PORT,
    publicHttpsPort: parsed.COMPARTMENT_PUBLIC_HTTPS_PORT,
  };
}

function readApiRuntimeConfig(parsed: ApiConfigEnv): ApiRuntimeConfig {
  return {
    auditFileSink: readAuditFileSinkConfig(parsed),
    auditRetentionCleanupBatchSize: parsed.COMPARTMENT_AUDIT_RETENTION_CLEANUP_BATCH_SIZE,
    auditRetentionCleanupCron: readRequiredCronExpression(
      parsed.COMPARTMENT_AUDIT_RETENTION_CLEANUP_CRON,
      'COMPARTMENT_AUDIT_RETENTION_CLEANUP_CRON',
    ),
    auditRetentionCleanupMaxBatches: parsed.COMPARTMENT_AUDIT_RETENTION_CLEANUP_MAX_BATCHES,
    auditRetentionDays: parsed.COMPARTMENT_AUDIT_RETENTION_DAYS,
    customTlsDirectory: readRequiredAbsolutePath(parsed.COMPARTMENT_CUSTOM_TLS_DIR, 'COMPARTMENT_CUSTOM_TLS_DIR'),
    rollbackRetentionLimit: parseOptionalPositiveInt(
      parsed.COMPARTMENT_ROLLBACK_RETENTION_LIMIT,
      'COMPARTMENT_ROLLBACK_RETENTION_LIMIT',
    ),
    resourceBackupDirectory: readRequiredAbsolutePath(
      parsed.COMPARTMENT_RESOURCE_BACKUP_DIR,
      'COMPARTMENT_RESOURCE_BACKUP_DIR',
    ),
    runtimeDefaultUpstreamHost: parsed.COMPARTMENT_RUNTIME_DEFAULT_UPSTREAM_HOST,
    sourceArchiveDirectory: parsed.COMPARTMENT_SOURCE_ARCHIVE_DIR,
    sourceArchiveMaxBytes: parsed.COMPARTMENT_SOURCE_ARCHIVE_MAX_BYTES,
    workerImageRef: readOptionalConfigText(parsed.COMPARTMENT_WORKER_IMAGE),
  };
}

function readApiSecretConfig(parsed: ApiConfigEnv): ApiSecretConfig {
  assertValidNodeAgentSocketPath(parsed.COMPARTMENT_NODE_AGENT_SOCKET);
  assertValidSystemApiSocketPath(parsed.COMPARTMENT_SYSTEM_API_SOCKET);

  return {
    nodeAgentSocketPath: parsed.COMPARTMENT_NODE_AGENT_SOCKET,
    systemApiSocketPath: parsed.COMPARTMENT_SYSTEM_API_SOCKET,
    systemToken: parsed.COMPARTMENT_SYSTEM_TOKEN,
    runtimeControlToken: parsed.COMPARTMENT_RUNTIME_CONTROL_TOKEN,
    variablesMasterKey: parseVariablesMasterKey(parsed.COMPARTMENT_VARIABLES_MASTER_KEY),
  };
}

function assertValidNodeAgentSocketPath(socketPath: string): void {
  assertValidUnixSocketPath(socketPath, nodeAgentSocketPolicy);
}
