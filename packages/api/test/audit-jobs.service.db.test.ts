import { asc, eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '@compartment/test-support';
import type { ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import { auditEvents, organizations } from '../src/db/schema';
import { parseVariablesMasterKey } from '../src/lib/variables-crypto';
import { configureApiRuntime } from '../src/runtime/runtime';
import { runAuditRetentionCleanup } from '../src/services/audit-retention-cleanup.service';
import type { AuditRetentionCleanupResult } from '../src/services/audit-retention-cleanup.service.types';
import { useApiRuntimeDatabaseTestHarness } from './api-db-test.harness';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';

const { testDatabaseUrl } = readDatabaseTestMode();
const databaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, 'audit_jobs_service');
const apiConfig: ApiConfig = {
  auditRetentionDays: 90,
  auditRetentionCleanupBatchSize: 1000,
  auditRetentionCleanupCron: '0 3 * * *',
  auditRetentionCleanupMaxBatches: 100,
  usageMeteringIntervalMs: 60_000,
  usageRetentionDays: 400,
  auditFileSink: defaultAuditFileSinkConfig,
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
  variablesMasterKey: parseVariablesMasterKey('11'.repeat(32)),
};
const pool: Pool = createDatabasePool(databaseUrl);
const db: Database = createDatabase(pool);
const dayMs: number = 24 * 60 * 60 * 1000;

interface AuditEventIdRow {
  id: string;
}

interface SeedOrganizationInput {
  id: string;
  name?: string | undefined;
  slug?: string | undefined;
}

describe('audit jobs services', (): void => {
  useApiRuntimeDatabaseTestHarness({ apiConfig, databaseUrl, db, pool });

  it('deletes expired organization audit events using effective retention policies', async (): Promise<void> => {
    await seedRetentionOrganizations();
    await seedAuditEvent('aud_inherit_expired', 'org_inherit', daysAgo(120));
    await seedAuditEvent('aud_inherit_recent', 'org_inherit', daysAgo(30));
    await seedAuditEvent('aud_keep_expired', 'org_keep', daysAgo(10));
    await seedAuditEvent('aud_keep_recent', 'org_keep', daysAgo(3));
    await seedAuditEvent('aud_indefinite_old', 'org_indefinite', daysAgo(365));

    const result: AuditRetentionCleanupResult = await runAuditRetentionCleanup();

    expect(result.deletedCount).toBe(2);
    expect(await listAuditEventIds()).toEqual(['aud_indefinite_old', 'aud_inherit_recent', 'aud_keep_recent']);
    expect(result.organizations).toEqual(
      expect.arrayContaining([
        {
          deletedCount: 1,
          effectivePolicy: { days: 90, mode: 'keep_days' },
          organizationId: 'org_inherit',
        },
        {
          deletedCount: 1,
          effectivePolicy: { days: 7, mode: 'keep_days' },
          organizationId: 'org_keep',
        },
        {
          deletedCount: 0,
          effectivePolicy: { days: null, mode: 'indefinite' },
          organizationId: 'org_indefinite',
        },
      ]),
    );
  });

  it('respects configured audit retention cleanup batch limits', async (): Promise<void> => {
    configureApiRuntime({
      config: {
        ...apiConfig,
        auditRetentionCleanupBatchSize: 1,
        auditRetentionCleanupMaxBatches: 1,
        usageMeteringIntervalMs: 60_000,
        usageRetentionDays: 400,
      },
      db,
    });
    await seedOrganization({ id: 'org_batch_limit', slug: 'org-batch-limit' });
    await seedAuditEvent('aud_batch_limit_1', 'org_batch_limit', daysAgo(120));
    await seedAuditEvent('aud_batch_limit_2', 'org_batch_limit', daysAgo(121));

    const result: AuditRetentionCleanupResult = await runAuditRetentionCleanup();

    expect(result.deletedCount).toBe(1);
    expect(await listAuditEventIds()).toEqual(['aud_batch_limit_1']);
  });
});

async function seedRetentionOrganizations(): Promise<void> {
  await seedOrganization({ id: 'org_inherit', slug: 'org-inherit' });
  await seedOrganization({ id: 'org_keep', slug: 'org-keep' });
  await seedOrganization({ id: 'org_indefinite', slug: 'org-indefinite' });
  await db
    .update(organizations)
    .set({ auditRetentionDays: 7, auditRetentionMode: 'keep_days' })
    .where(eq(organizations.id, 'org_keep'));
  await db
    .update(organizations)
    .set({ auditRetentionDays: null, auditRetentionMode: 'indefinite' })
    .where(eq(organizations.id, 'org_indefinite'));
}

async function seedOrganization(input: SeedOrganizationInput): Promise<void> {
  await db.insert(organizations).values({
    id: input.id,
    name: input.name ?? 'Acme Dev',
    slug: input.slug ?? 'acme-dev',
  });
}

async function seedAuditEvent(id: string, organizationId: string, occurredAt: Date): Promise<void> {
  await db.insert(auditEvents).values({
    actorType: 'system',
    eventType: 'organization.settings.updated',
    id,
    metadataJson: '{}',
    occurredAt,
    organizationId,
    scopeType: 'organization',
    status: 'succeeded',
    targetId: organizationId,
    targetType: 'organization',
  });
}

async function listAuditEventIds(): Promise<string[]> {
  const rows: AuditEventIdRow[] = await db
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .orderBy(asc(auditEvents.id));

  return rows.map((row: AuditEventIdRow): string => row.id);
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * dayMs);
}
