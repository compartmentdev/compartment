import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { ResourceBackupPurpose } from '@compartment/contracts';
import { resourceBackups } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type {
  CompleteResourceBackupInput,
  CreateResourceBackupInput,
  FailResourceBackupInput,
  MarkResourceBackupRetentionDeletedInput,
  PersistedResourceBackupRow,
  ResourceBackupMutationExecutor,
  ResourceBackupRow,
  RecordResourceBackupRetentionFailureInput,
} from './resource-backups.query.types';

export async function createResourceBackupWithExecutor(
  executor: ResourceBackupMutationExecutor,
  input: CreateResourceBackupInput,
): Promise<ResourceBackupRow> {
  const [backup] = await executor.insert(resourceBackups).values(input).returning();

  return requireResourceBackupRow(backup !== undefined ? toResourceBackupRow(backup) : undefined);
}

export async function listResourceBackups(projectResourceId: string): Promise<ResourceBackupRow[]> {
  const rows: PersistedResourceBackupRow[] = await getApiDatabase()
    .select()
    .from(resourceBackups)
    .where(eq(resourceBackups.projectResourceId, projectResourceId))
    .orderBy(desc(resourceBackups.createdAt));

  return rows.map(toResourceBackupRow);
}

export async function findResourceBackupById(backupId: string): Promise<ResourceBackupRow | undefined> {
  const rows: PersistedResourceBackupRow[] = await getApiDatabase()
    .select()
    .from(resourceBackups)
    .where(eq(resourceBackups.id, backupId))
    .limit(1);

  return rows[0] !== undefined ? toResourceBackupRow(rows[0]) : undefined;
}

export async function listRetentionEligibleResourceBackups(
  projectResourceId: string,
  includeManual: boolean,
): Promise<ResourceBackupRow[]> {
  const purposes: ResourceBackupPurpose[] = includeManual ? ['manual', 'scheduled'] : ['scheduled'];
  const rows: PersistedResourceBackupRow[] = await getApiDatabase()
    .select()
    .from(resourceBackups)
    .where(
      and(
        eq(resourceBackups.projectResourceId, projectResourceId),
        eq(resourceBackups.status, 'succeeded'),
        inArray(resourceBackups.purpose, purposes),
      ),
    )
    .orderBy(desc(resourceBackups.createdAt));

  return rows.map(toResourceBackupRow);
}

export async function completeResourceBackupWithExecutor(
  executor: ResourceBackupMutationExecutor,
  input: CompleteResourceBackupInput,
): Promise<ResourceBackupRow> {
  const [backup] = await executor
    .update(resourceBackups)
    .set({
      artifactLocation: input.artifactLocation,
      checksum: input.checksum,
      completedAt: input.completedAt,
      manifestJson: input.manifestJson,
      resourceDefinitionJson: input.resourceDefinitionJson,
      sizeBytes: input.sizeBytes,
      status: 'succeeded',
      stderrSummary: input.stderrSummary,
      stdoutSummary: input.stdoutSummary,
    })
    .where(eq(resourceBackups.id, input.backupId))
    .returning();

  return requireResourceBackupRow(backup !== undefined ? toResourceBackupRow(backup) : undefined);
}

export async function failResourceBackupWithExecutor(
  executor: ResourceBackupMutationExecutor,
  input: FailResourceBackupInput,
): Promise<ResourceBackupRow> {
  const [backup] = await executor
    .update(resourceBackups)
    .set({
      completedAt: input.completedAt,
      failureSummary: input.failureSummary,
      ...(input.manifestJson !== undefined ? { manifestJson: input.manifestJson } : {}),
      status: 'failed',
      stderrSummary: input.stderrSummary,
      stdoutSummary: input.stdoutSummary,
    })
    .where(eq(resourceBackups.id, input.backupId))
    .returning();

  return requireResourceBackupRow(backup !== undefined ? toResourceBackupRow(backup) : undefined);
}

export async function markResourceBackupRetentionDeletedWithExecutor(
  executor: ResourceBackupMutationExecutor,
  input: MarkResourceBackupRetentionDeletedInput,
): Promise<ResourceBackupRow> {
  const [backup] = await executor
    .update(resourceBackups)
    .set({
      artifactLocation: null,
      failureSummary: null,
      retentionDeletedAt: input.retentionDeletedAt,
      retentionFailureSummary: null,
      retentionNextAttemptAt: null,
      retentionReason: input.retentionReason,
      status: 'deleted',
    })
    .where(eq(resourceBackups.id, input.backupId))
    .returning();

  return requireResourceBackupRow(backup !== undefined ? toResourceBackupRow(backup) : undefined);
}

export async function recordResourceBackupRetentionFailureWithExecutor(
  executor: ResourceBackupMutationExecutor,
  input: RecordResourceBackupRetentionFailureInput,
): Promise<ResourceBackupRow> {
  const [backup] = await executor
    .update(resourceBackups)
    .set({
      failureSummary: input.failureSummary,
      retentionAttempts: sql`${resourceBackups.retentionAttempts} + 1`,
      retentionFailureSummary: input.failureSummary,
      retentionNextAttemptAt: sql`${input.failedAt}::timestamptz + least(
        ${input.retryMaxDelayMs},
        ${input.retryInitialDelayMs} * power(2, least(${resourceBackups.retentionAttempts}, 30))
      ) * interval '1 millisecond'`,
    })
    .where(eq(resourceBackups.id, input.backupId))
    .returning();

  return requireResourceBackupRow(backup !== undefined ? toResourceBackupRow(backup) : undefined);
}

function toResourceBackupRow(row: PersistedResourceBackupRow): ResourceBackupRow {
  return row;
}

function requireResourceBackupRow(row: ResourceBackupRow | undefined): ResourceBackupRow {
  if (row === undefined) {
    throw new Error('Failed to persist resource backup.');
  }

  return row;
}
