import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AuditEventSummary } from '@compartment/contracts';
import { readFileModePermissions } from '@compartment/test-support';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import type { ApiConfig, AuditFileSinkConfig } from '../src/config';
import { parseVariablesMasterKey } from '../src/lib/variables-crypto';
import {
  closeAuditEventFileSink,
  initializeAuditEventFileSink,
  writeAuditEventToLocalFileSink,
} from '../src/services/audit-event-file-sink.service';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';

const logger: pino.Logger<never, boolean> = pino({ level: 'silent' });
let cleanupDirectories: string[] = [];

describe('audit event file sink service', (): void => {
  afterEach(async (): Promise<void> => {
    await closeAuditEventFileSink();
    await Promise.all(cleanupDirectories.map(removeDirectory));
    cleanupDirectories = [];
  });

  it('writes audit summaries as local NDJSON when enabled', async (): Promise<void> => {
    const directory: string = await createTemporaryDirectory();
    const event: AuditEventSummary = buildAuditEventSummary();
    initializeAuditEventFileSink({
      config: buildApiConfig({
        directory,
        enabled: true,
        retentionFiles: 30,
        rotateInterval: '1d',
        rotateSize: '64M',
      }),
      logger,
    });

    writeAuditEventToLocalFileSink(event);
    await closeAuditEventFileSink();

    const content: string = await readFile(join(directory, 'audit.ndjson'), 'utf8');
    expect(content.trim().split('\n').map(parseAuditEventSummary)).toEqual([event]);
    expect(readFileModePermissions((await stat(directory)).mode)).toBe(0o700);
    expect(readFileModePermissions((await stat(join(directory, 'audit.ndjson'))).mode)).toBe(0o600);
  });

  it('does not create a local audit file when disabled', async (): Promise<void> => {
    const directory: string = await createTemporaryDirectory();
    initializeAuditEventFileSink({
      config: buildApiConfig({
        directory,
        enabled: false,
        retentionFiles: 30,
        rotateInterval: '1d',
        rotateSize: '64M',
      }),
      logger,
    });

    writeAuditEventToLocalFileSink(buildAuditEventSummary());
    await closeAuditEventFileSink();

    await expect(readdir(directory)).resolves.toEqual([]);
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory: string = await mkdtemp(join(tmpdir(), 'compartment-audit-file-sink-'));
  cleanupDirectories.push(directory);
  return directory;
}

async function removeDirectory(directory: string): Promise<void> {
  await rm(directory, { force: true, recursive: true });
}

function parseAuditEventSummary(line: string): AuditEventSummary {
  return JSON.parse(line) as AuditEventSummary;
}

function buildAuditEventSummary(): AuditEventSummary {
  return {
    actor: {
      email: 'admin@example.com',
      principalId: 'prn_123',
      sessionId: 'ses_123',
      sourceIp: '127.0.0.1',
      transport: 'bearer',
      type: 'user',
      userAgent: 'vitest',
    },
    eventType: 'organization.settings.updated',
    id: 'aud_123',
    metadata: {
      auditRetentionUpdated: true,
      rollbackRetentionUpdated: false,
    },
    occurredAt: '2026-05-14T12:00:00.000Z',
    organizationId: 'org_123',
    scopeType: 'organization',
    status: 'succeeded',
    target: {
      displayName: 'Acme',
      environmentId: null,
      id: 'org_123',
      projectId: null,
      serviceId: null,
      type: 'organization',
    },
  };
}

function buildApiConfig(auditFileSink: AuditFileSinkConfig): ApiConfig {
  return {
    auditFileSink,
    auditRetentionDays: 90,
    auditRetentionCleanupBatchSize: 1000,
    auditRetentionCleanupCron: '0 3 * * *',
    auditRetentionCleanupMaxBatches: 100,
    usageMeteringIntervalMs: 60_000,
    usageRetentionDays: 400,
    baseDomain: 'localhost',
    bindHost: '127.0.0.1',
    tlsMode: 'internal',
    controlPlaneHost: 'console.localhost',
    databaseUrl: 'postgresql://postgres:postgres@127.0.0.1:5432/compartment_dev',
    edgeToken: 'test-edge-token',
    edgeUrl: 'http://127.0.0.1:9081',
    logLevel: 'silent',
    port: 9443,
    publicHttpPort: 9080,
    publicHttpsPort: 443,
    publicProtocol: 'http',
    rollbackRetentionLimit: null,
    runtimeControlToken: 'test-runtime-control-token',
    sessionSecret: 'test-secret',
    sessionTtlMs: 604_800_000,
    signupEnabled: false,
    sourceArchiveDirectory: '/tmp/compartment-test-source-archives',
    sourceArchiveMaxBytes: 104_857_600,
    systemApiSocketPath: '/tmp/compartment/compartment-test-system-api.sock',
    systemToken: 'test-system-token',
    throttle: defaultApiAuthThrottleConfig,
    trustedOutboundHosts: [],
    tenantSecretsKek: parseVariablesMasterKey('11'.repeat(32)),
    variablesMasterKey: parseVariablesMasterKey('11'.repeat(32)),
  };
}
