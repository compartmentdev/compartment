import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '../../test-support/src';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import { environments, operations, organizations, projectResources, projects, resourceBackups } from '../src/db/schema';
import {
  completeResourceBackupWithExecutor,
  createResourceBackupWithExecutor,
  markResourceBackupRetentionDeletedWithExecutor,
  recordResourceBackupRetentionFailureWithExecutor,
} from '../src/queries/resource-backups.query';
import type { ResourceBackupRow } from '../src/queries/resource-backups.query.types';
import { useApiDatabaseTestHarness } from './api-db-test.harness';

const { testDatabaseUrl } = readDatabaseTestMode();
const databaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, 'resource_backup_retention_query_db');
const pool: Pool = createDatabasePool(databaseUrl);
const resourceOperationPool: Pool = new Pool({ connectionString: databaseUrl, max: 1 });
const db: Database = createDatabase(pool, resourceOperationPool);

describe('resource backup retention queries', (): void => {
  useApiDatabaseTestHarness(databaseUrl);

  afterAll(async (): Promise<void> => {
    await Promise.all([pool.end(), resourceOperationPool.end()]);
  });

  beforeEach(async (): Promise<void> => {
    await db.insert(organizations).values({ id: 'org_retention', name: 'Acme', slug: 'acme' });
    await db.insert(projects).values({
      defaultAccessMode: 'authenticated',
      id: 'prj_retention',
      name: 'app',
      organizationId: 'org_retention',
    });
    await db.insert(environments).values({ id: 'env_retention', name: 'production', projectId: 'prj_retention' });
    await db.insert(projectResources).values({
      commandJson: '[]',
      envJson: '[]',
      environmentId: 'env_retention',
      id: 'res_retention',
      image: 'postgres:16',
      name: 'postgres',
      portsJson: '[5432]',
      readinessJson: 'null',
      runtimeDefinitionHash: 'runtime',
      status: 'running',
      volumesJson: '[]',
    });
    await db.insert(operations).values({
      id: 'op_backup',
      status: 'succeeded',
      summary: 'Backup succeeded.',
      targetId: 'res_retention',
      targetType: 'resource',
      type: 'resource.backup',
    });
  });

  it('persists exponential capped retry metadata without changing backup success', async (): Promise<void> => {
    const backup: ResourceBackupRow = await createResourceBackupWithExecutor(db, {
      createdByPrincipalId: null,
      id: 'rbak_retention',
      operationId: 'op_backup',
      projectResourceId: 'res_retention',
      purpose: 'scheduled',
      status: 'running',
    });
    await completeResourceBackupWithExecutor(db, {
      artifactLocation: 'pvc://rbak_retention',
      backupId: backup.id,
      checksum: null,
      completedAt: new Date('2026-07-22T11:00:00.000Z'),
      manifestJson: '{}',
      resourceDefinitionJson: '{}',
      sizeBytes: null,
      stderrSummary: '',
      stdoutSummary: 'dumped',
    });
    const failedAt: Date = new Date('2026-07-22T12:00:00.000Z');

    const failed: ResourceBackupRow = await recordResourceBackupRetentionFailureWithExecutor(db, {
      backupId: backup.id,
      failedAt,
      failureSummary: 'EACCES',
      retryInitialDelayMs: 60_000,
      retryMaxDelayMs: 3_600_000,
    });

    expect(failed).toMatchObject({
      failureSummary: 'EACCES',
      retentionAttempts: 1,
      retentionFailureSummary: 'EACCES',
      retentionNextAttemptAt: new Date('2026-07-22T12:01:00.000Z'),
      status: 'succeeded',
    });

    const secondFailure: ResourceBackupRow = await recordResourceBackupRetentionFailureWithExecutor(db, {
      backupId: backup.id,
      failedAt: new Date('2026-07-22T12:01:00.000Z'),
      failureSummary: 'EACCES again',
      retryInitialDelayMs: 60_000,
      retryMaxDelayMs: 3_600_000,
    });
    expect(secondFailure).toMatchObject({
      failureSummary: 'EACCES again',
      retentionAttempts: 2,
      retentionNextAttemptAt: new Date('2026-07-22T12:03:00.000Z'),
    });

    await db.update(resourceBackups).set({ retentionAttempts: 30 }).where(eq(resourceBackups.id, backup.id));
    const cappedFailure: ResourceBackupRow = await recordResourceBackupRetentionFailureWithExecutor(db, {
      backupId: backup.id,
      failedAt: new Date('2026-07-22T13:00:00.000Z'),
      failureSummary: 'still EACCES',
      retryInitialDelayMs: 60_000,
      retryMaxDelayMs: 3_600_000,
    });
    expect(cappedFailure).toMatchObject({
      retentionAttempts: 31,
      retentionNextAttemptAt: new Date('2026-07-22T14:00:00.000Z'),
      status: 'succeeded',
    });

    const deleted: ResourceBackupRow = await markResourceBackupRetentionDeletedWithExecutor(db, {
      backupId: backup.id,
      retentionDeletedAt: new Date('2026-07-22T14:00:00.000Z'),
      retentionReason: 'retention maxAgeDays=1',
    });
    expect(deleted).toMatchObject({
      failureSummary: null,
      retentionAttempts: 31,
      retentionFailureSummary: null,
      retentionNextAttemptAt: null,
      status: 'deleted',
    });
  });
});
