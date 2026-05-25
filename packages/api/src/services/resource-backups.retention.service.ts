import type { CompartmentResourceOperationRetentionConfig } from '@compartment/contracts';
import {
  listRetentionEligibleResourceBackups,
  markResourceBackupRetentionDeletedWithExecutor,
} from '../queries/resource-backups.query';
import type { ResourceBackupRow } from '../queries/resource-backups.query.types';
import type { ResourceTransaction } from '../queries/resources.query.types';
import { getApiDatabase } from '../runtime/runtime-access';
import { deleteResourceBackupArtifactDirectory } from './resource-backup-artifact.service';
import type { ResourceBackupRetentionCleanup } from './resources.service.types';

export async function applyResourceBackupRetention(
  projectResourceId: string,
  retention: CompartmentResourceOperationRetentionConfig | null | undefined,
  now: Date,
): Promise<ResourceBackupRetentionCleanup[]> {
  if (retention === null || retention === undefined) {
    return [];
  }

  const backups: ResourceBackupRow[] = await listRetentionEligibleResourceBackups(
    projectResourceId,
    retention.includeManual === true,
  );
  const expiredBackups: ResourceBackupRetentionCleanup[] = selectExpiredBackups(backups, retention, now);
  const cleanedBackups: ResourceBackupRetentionCleanup[] = [];

  for (const expiredBackup of expiredBackups) {
    cleanedBackups.push(await deleteBackupArtifactAndMarkRecord(expiredBackup, now));
  }

  return cleanedBackups;
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
  now: Date,
): Promise<ResourceBackupRetentionCleanup> {
  if (cleanup.backup.artifactLocation !== null) {
    await deleteResourceBackupArtifactDirectory(cleanup.backup.artifactLocation);
  }

  const backup: ResourceBackupRow = await getApiDatabase().transaction(
    async (tx: ResourceTransaction): Promise<ResourceBackupRow> =>
      await markResourceBackupRetentionDeletedWithExecutor(tx, {
        backupId: cleanup.backup.id,
        retentionDeletedAt: now,
        retentionReason: cleanup.reason,
      }),
  );

  return {
    backup,
    reason: cleanup.reason,
  };
}
