import { listScheduledResourceOperationCandidates } from '../queries/resource-operation-scheduler.query';
import type { ScheduledResourceOperationCandidateRow } from '../queries/resource-operation-scheduler.query.types';
import { runDueScheduledResourceBackup } from './resource-backups.service';
import type { ResourceBackupRetentionCleanup, ScheduledResourceBackupRunResult } from './resources.service.types';
import type {
  ScheduledResourceOperationCleanupResult,
  ScheduledResourceOperationResult,
} from './resource-operation-scheduler.service.types';

export async function runNextScheduledResourceOperationForWorker(): Promise<ScheduledResourceOperationResult> {
  const now: Date = new Date();
  const candidates: ScheduledResourceOperationCandidateRow[] = await listScheduledResourceOperationCandidates();

  for (const candidate of candidates) {
    const result: ScheduledResourceBackupRunResult | null = await runDueScheduledResourceBackup(
      candidate,
      candidate.resource.name,
      now,
    );
    if (result !== null) {
      return buildRanScheduledResourceOperationResult(result);
    }
  }

  return buildEmptyScheduledResourceOperationResult();
}

function buildRanScheduledResourceOperationResult(
  result: ScheduledResourceBackupRunResult,
): ScheduledResourceOperationResult {
  return {
    backupId: result.backup.id,
    cleanedBackups: result.cleanedBackups.map(
      (cleanup: ResourceBackupRetentionCleanup): ScheduledResourceOperationCleanupResult => ({
        backupId: cleanup.backup.id,
        reason: cleanup.reason,
      }),
    ),
    operationType: 'backup',
    resourceName: result.resource.name,
    ran: true,
  };
}

function buildEmptyScheduledResourceOperationResult(): ScheduledResourceOperationResult {
  return {
    backupId: null,
    cleanedBackups: [],
    operationType: null,
    resourceName: null,
    ran: false,
  };
}
