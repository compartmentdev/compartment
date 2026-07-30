import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AuditEventSummary } from '@compartment/contracts';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '@compartment/test-support';
import { asc } from 'drizzle-orm';
import pino from 'pino';
import type { Pool } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import type { ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import { auditEvents, organizations } from '../src/db/schema';
import { parseVariablesMasterKey } from '../src/lib/variables-crypto';
import type { AuditEventWriteExecutor } from '../src/queries/audit-events.query.types';
import { closeAuditEventFileSink, initializeAuditEventFileSink } from '../src/services/audit-event-file-sink.service';
import { recordAuditEvent, writeCommittedAuditEventsToLocalFileSink } from '../src/services/audit-events.service';
import type { AuditEventResult, RecordAuditEventInput } from '../src/services/audit-events.service.types';
import { useApiRuntimeDatabaseTestHarness } from './api-db-test.harness';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';

const { testDatabaseUrl } = readDatabaseTestMode();
const databaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, 'audit_events_service');
const apiConfig: ApiConfig = {
  auditFileSink: defaultAuditFileSinkConfig,
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
  databaseUrl,
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
  sourceArchiveDirectory: '/tmp/compartment-test-source-archives',
  sourceArchiveMaxBytes: 104_857_600,
  systemApiSocketPath: '/tmp/compartment/compartment-test-system-api.sock',
  systemToken: 'test-system-token',
  throttle: defaultApiAuthThrottleConfig,
  trustedOutboundHosts: [],
  tenantSecretsKek: parseVariablesMasterKey('11'.repeat(32)),
  variablesMasterKey: parseVariablesMasterKey('11'.repeat(32)),
};
const pool: Pool = createDatabasePool(databaseUrl);
const db: Database = createDatabase(pool);
const logger: pino.Logger<never, boolean> = pino({ level: 'silent' });
let cleanupDirectories: string[] = [];

interface AuditEventIdRow {
  id: string;
}

describe('audit events service', (): void => {
  useApiRuntimeDatabaseTestHarness({
    apiConfig,
    databaseUrl,
    db,
    pool,
    setup: async (): Promise<void> => {
      await seedOrganization();
    },
  });

  afterEach(async (): Promise<void> => {
    await closeAuditEventFileSink();
    await Promise.all(cleanupDirectories.map(removeDirectory));
    cleanupDirectories = [];
  });

  it('mirrors committed transactional audit events to the local file sink', async (): Promise<void> => {
    const directory: string = await createTemporaryDirectory();
    initializeAuditEventFileSink({ config: buildApiConfigWithFileSink(directory), logger });

    const events: AuditEventResult[] = await db.transaction(
      async (transaction: AuditEventWriteExecutor): Promise<AuditEventResult[]> => [
        await recordAuditEvent({
          ...buildRecordAuditEventInput(),
          executor: transaction,
        }),
      ],
    );
    writeCommittedAuditEventsToLocalFileSink(events);
    await closeAuditEventFileSink();

    const event: AuditEventResult = readSingleAuditEventResult(events);
    expect(await listAuditEventIds()).toEqual([event.id]);
    expect(await readAuditFileSinkEvents(directory)).toEqual(events);
  });

  it('does not mirror rolled-back transactional audit events to the local file sink', async (): Promise<void> => {
    const directory: string = await createTemporaryDirectory();
    initializeAuditEventFileSink({ config: buildApiConfigWithFileSink(directory), logger });

    await expect(
      db.transaction(async (transaction: AuditEventWriteExecutor): Promise<void> => {
        await recordAuditEvent({
          ...buildRecordAuditEventInput(),
          executor: transaction,
        });
        throw new Error('rollback audit event');
      }),
    ).rejects.toThrow('rollback audit event');
    await closeAuditEventFileSink();

    expect(await listAuditEventIds()).toEqual([]);
    expect(await readdir(directory)).toEqual(['audit.ndjson']);
    await expect(readFile(join(directory, 'audit.ndjson'), 'utf8')).resolves.toBe('');
  });
});

async function seedOrganization(): Promise<void> {
  await db.insert(organizations).values({
    id: 'org_123',
    name: 'Acme',
    slug: 'acme',
  });
}

async function listAuditEventIds(): Promise<string[]> {
  const rows: AuditEventIdRow[] = await db
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .orderBy(asc(auditEvents.id));

  return rows.map((row: AuditEventIdRow): string => row.id);
}

async function createTemporaryDirectory(): Promise<string> {
  const directory: string = await mkdtemp(join(tmpdir(), 'compartment-audit-events-service-'));
  cleanupDirectories.push(directory);
  return directory;
}

async function removeDirectory(directory: string): Promise<void> {
  await rm(directory, { force: true, recursive: true });
}

async function readAuditFileSinkEvents(directory: string): Promise<AuditEventSummary[]> {
  const content: string = await readFile(join(directory, 'audit.ndjson'), 'utf8');

  return content.trim().split('\n').map(parseAuditEventSummary);
}

function parseAuditEventSummary(line: string): AuditEventSummary {
  return JSON.parse(line) as AuditEventSummary;
}

function buildApiConfigWithFileSink(directory: string): ApiConfig {
  return {
    ...apiConfig,
    auditFileSink: {
      ...defaultAuditFileSinkConfig,
      directory,
      enabled: true,
    },
  };
}

function buildRecordAuditEventInput(): RecordAuditEventInput {
  return {
    actor: {
      email: 'admin@example.com',
      sourceIp: '127.0.0.1',
      transport: 'bearer',
      type: 'user',
      userAgent: 'vitest',
    },
    eventType: 'organization.settings.updated',
    metadata: {
      auditRetentionUpdated: true,
      rollbackRetentionUpdated: false,
    },
    organizationId: 'org_123',
    target: {
      displayName: 'Acme',
      id: 'org_123',
      type: 'organization',
    },
  };
}

function readSingleAuditEventResult(events: AuditEventResult[]): AuditEventResult {
  const [event] = events;
  if (event === undefined) {
    throw new Error('Expected audit event.');
  }

  return event;
}
