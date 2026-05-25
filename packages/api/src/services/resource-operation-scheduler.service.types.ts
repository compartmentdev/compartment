export interface ScheduledResourceOperationCleanupResult {
  backupId: string;
  reason: string;
}

export interface ScheduledResourceOperationResult {
  backupId: string | null;
  cleanedBackups: ScheduledResourceOperationCleanupResult[];
  operationType: 'backup' | null;
  resourceName: string | null;
  ran: boolean;
}
