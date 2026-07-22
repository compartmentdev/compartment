import type { CompartmentResourceOperationRetentionConfig } from '@compartment/contracts';
import {
  listRetentionEligibleResourceBackups,
  markResourceBackupRetentionDeletedWithExecutor,
  recordResourceBackupRetentionFailureWithExecutor,
} from '../queries/resource-backups.query';
import type { ResourceBackupRow } from '../queries/resource-backups.query.types';
import { insertOperationRecordWithExecutor } from '../queries/operations.query';
import type { ProjectResourceRow, ResourceTransaction } from '../queries/resources.query.types';
import { getApiDatabase } from '../runtime/runtime-access';
import { deleteKubernetesBackupArtifact } from './resource-backups.kubernetes.service';
import { ResourceBackupRetentionOperationError } from './resource-backup-retention-operation.error';
import type {
  ResourceBackupRetentionCleanup,
  ResourceBackupRetentionResult,
  ResourceEnvironmentContext,
} from './resources.service.types';

interface ResourceBackupRetentionInput {
  context: ResourceEnvironmentContext;
  now: Date;
  resource: ProjectResourceRow;
  retention: CompartmentResourceOperationRetentionConfig | null | undefined;
}

const retentionRetryInitialDelayMs: number = 60_000;
const retentionRetryMaxDelayMs: number = 60 * 60_000;

export async function applyResourceBackupRetention(
  input: ResourceBackupRetentionInput,
): Promise<ResourceBackupRetentionResult> {
  if (input.retention === null || input.retention === undefined) {
    return { attempted: false, cleanedBackups: [], recordedFailure: false };
  }

  const backups: ResourceBackupRow[] = await listRetentionEligibleResourceBackups(
    input.resource.id,
    input.retention.includeManual === true,
  );
  const expiredBackups: ResourceBackupRetentionCleanup[] = selectExpiredBackups(
    backups,
    input.retention,
    input.now,
  ).filter((cleanup: ResourceBackupRetentionCleanup): boolean => isRetentionAttemptDue(cleanup.backup, input.now));
  return await executeRetentionCleanups(expiredBackups, input);
}

async function executeRetentionCleanups(
  expiredBackups: ResourceBackupRetentionCleanup[],
  input: ResourceBackupRetentionInput,
): Promise<ResourceBackupRetentionResult> {
  const cleanedBackups: ResourceBackupRetentionCleanup[] = [];
  let recordedFailure: boolean = false;

  for (const expiredBackup of expiredBackups) {
    const cleanedBackup: ResourceBackupRetentionCleanup | null = await deleteBackupArtifactAndMarkRecord(
      expiredBackup,
      input,
    );
    if (cleanedBackup !== null) {
      cleanedBackups.push(cleanedBackup);
    } else {
      recordedFailure = true;
      break;
    }
  }

  return { attempted: expiredBackups.length > 0, cleanedBackups, recordedFailure };
}

function isRetentionAttemptDue(backup: ResourceBackupRow, now: Date): boolean {
  return backup.retentionNextAttemptAt === null || backup.retentionNextAttemptAt <= now;
}

function selectExpiredBackups(
  backups: ResourceBackupRow[],
  retention: CompartmentResourceOperationRetentionConfig,
  now: Date,
): ResourceBackupRetentionCleanup[] {
  const expiredBackups: Map<string, ResourceBackupRetentionCleanup> = new Map<string, ResourceBackupRetentionCleanup>();
  addKeepLastExpirations(expiredBackups, backups, retention);
  addMaxAgeExpirations(expiredBackups, backups, retention, now);

  return [...expiredBackups.values()];
}

function addKeepLastExpirations(
  expiredBackups: Map<string, ResourceBackupRetentionCleanup>,
  backups: ResourceBackupRow[],
  retention: CompartmentResourceOperationRetentionConfig,
): void {
  if (retention.keepLast === undefined) {
    return;
  }

  backups.slice(retention.keepLast).forEach((backup: ResourceBackupRow): void => {
    expiredBackups.set(backup.id, {
      backup,
      reason: `retention keepLast=${retention.keepLast}`,
    });
  });
}

function addMaxAgeExpirations(
  expiredBackups: Map<string, ResourceBackupRetentionCleanup>,
  backups: ResourceBackupRow[],
  retention: CompartmentResourceOperationRetentionConfig,
  now: Date,
): void {
  if (retention.maxAgeDays === undefined) {
    return;
  }

  const cutoffTime: number = now.getTime() - retention.maxAgeDays * 24 * 60 * 60 * 1000;
  backups
    .filter((backup: ResourceBackupRow): boolean => backup.createdAt.getTime() < cutoffTime)
    .forEach((backup: ResourceBackupRow): void => {
      expiredBackups.set(backup.id, {
        backup,
        reason: `retention maxAgeDays=${retention.maxAgeDays}`,
      });
    });
}

async function deleteBackupArtifactAndMarkRecord(
  cleanup: ResourceBackupRetentionCleanup,
  input: ResourceBackupRetentionInput,
): Promise<ResourceBackupRetentionCleanup | null> {
  if (cleanup.backup.artifactLocation !== null) {
    try {
      await deleteKubernetesBackupArtifact({
        backup: cleanup.backup,
        context: input.context,
        resource: input.resource,
      });
    } catch (error) {
      if (!(error instanceof ResourceBackupRetentionOperationError)) {
        throw error;
      }
      await recordResourceBackupRetentionFailure(cleanup.backup, input, error);
      return null;
    }
  }
  const backup: ResourceBackupRow = await markResourceBackupRetentionDeleted(cleanup, input.now);
  return {
    backup,
    reason: cleanup.reason,
  };
}

async function markResourceBackupRetentionDeleted(
  cleanup: ResourceBackupRetentionCleanup,
  retentionDeletedAt: Date,
): Promise<ResourceBackupRow> {
  return await getApiDatabase().transaction(
    async (tx: ResourceTransaction): Promise<ResourceBackupRow> =>
      await markResourceBackupRetentionDeletedWithExecutor(tx, {
        backupId: cleanup.backup.id,
        retentionDeletedAt,
        retentionReason: cleanup.reason,
      }),
  );
}

async function recordResourceBackupRetentionFailure(
  backup: ResourceBackupRow,
  input: ResourceBackupRetentionInput,
  failure: Error,
): Promise<void> {
  await getApiDatabase().transaction(async (tx: ResourceTransaction): Promise<void> => {
    const failedBackup: ResourceBackupRow = await recordResourceBackupRetentionFailureWithExecutor(tx, {
      backupId: backup.id,
      failedAt: input.now,
      failureSummary: failure.message,
      retryInitialDelayMs: retentionRetryInitialDelayMs,
      retryMaxDelayMs: retentionRetryMaxDelayMs,
    });
    await insertOperationRecordWithExecutor(tx, {
      completedAt: input.now,
      status: 'failed',
      summary: `Backup retention failed: ${failure.message}. Retry scheduled for ${failedBackup.retentionNextAttemptAt?.toISOString() ?? 'later'}.`,
      targetId: backup.id,
      targetType: 'resource_backup',
      type: 'resource.backup.retention',
    });
  });
}
