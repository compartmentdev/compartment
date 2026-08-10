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
import type { AuditEventWriteExecutor } from '../src/queries/audit-events.query.types';
import { closeAuditEventFileSink, initializeAuditEventFileSink } from '../src/services/audit-event-file-sink.service';
import { recordAuditEvent, writeCommittedAuditEventsToLocalFileSink } from '../src/services/audit-events.service';
import type {
  AuditEventActorInput,
  AuditEventResult,
  RecordAuditEventInput,
} from '../src/services/audit-events.service.types';
import { useApiRuntimeDatabaseTestHarness } from './api-db-test.harness';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';
import { createApiTestConfig } from './api-config-test.fixtures';

const { testDatabaseUrl } = readDatabaseTestMode();
const databaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, 'audit_events_service');
const apiConfig: ApiConfig = createApiTestConfig({
  databaseUrl,
});
const pool: Pool = createDatabasePool(databaseUrl);
const db: Database = createDatabase(pool);
const logger: pino.Logger<never, boolean> = pino({ level: 'silent' });
let cleanupDirectories: string[] = [];

interface AuditEventIdRow {
  id: string;
}

interface AuditEventScopeRow {
  organizationId: string | null;
  scopeType: string;
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

  it('records an installation-scoped event without an owning organization', async (): Promise<void> => {
    const event: AuditEventResult = await recordAuditEvent({
      actor: buildAuditEventActor(),
      eventType: 'installation.organization.created',
      metadata: { organizationSlug: 'acme' },
      scopeType: 'installation',
      target: {
        displayName: 'Acme',
        id: 'org_123',
        type: 'organization',
      },
    });

    expect(event).toMatchObject({
      organizationId: null,
      scopeType: 'installation',
    });
    expect(await readStoredAuditEventScopes()).toEqual([{ organizationId: null, scopeType: 'installation' }]);
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

async function readStoredAuditEventScopes(): Promise<AuditEventScopeRow[]> {
  return await db
    .select({ organizationId: auditEvents.organizationId, scopeType: auditEvents.scopeType })
    .from(auditEvents)
    .orderBy(asc(auditEvents.id));
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

function buildAuditEventActor(): AuditEventActorInput {
  return {
    email: 'admin@example.com',
    sourceIp: '127.0.0.1',
    transport: 'bearer',
    type: 'user',
    userAgent: 'vitest',
  };
}

function buildRecordAuditEventInput(): RecordAuditEventInput {
  return {
    actor: buildAuditEventActor(),
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
