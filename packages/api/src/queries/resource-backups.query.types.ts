import type { ResourceBackupPurpose, ResourceBackupStatus } from '@compartment/contracts';
import type { Database } from '../db/client';
import type { resourceBackups } from '../db/schema';

export type ResourceBackupMutationExecutor = Pick<Database, 'insert' | 'update'>;

export interface ResourceBackupRow {
  artifactLocation: string | null;
  checksum: string | null;
  completedAt: Date | null;
  createdAt: Date;
  createdByPrincipalId: string | null;
  failureSummary: string | null;
  id: string;
  manifestJson: string | null;
  operationId: string;
  projectResourceId: string;
  purpose: ResourceBackupPurpose;
  retentionAttempts: number;
  retentionDeletedAt: Date | null;
  retentionFailureSummary: string | null;
  retentionNextAttemptAt: Date | null;
  retentionReason: string | null;
  resourceDefinitionJson: string | null;
  sizeBytes: number | null;
  status: ResourceBackupStatus;
  stderrSummary: string | null;
  stdoutSummary: string | null;
}

export type PersistedResourceBackupRow = typeof resourceBackups.$inferSelect;

export interface CreateResourceBackupInput {
  createdByPrincipalId: string | null;
  id: string;
  operationId: string;
  projectResourceId: string;
  purpose: ResourceBackupPurpose;
  status: ResourceBackupStatus;
}

export interface CompleteResourceBackupInput {
  artifactLocation: string;
  backupId: string;
  checksum: string | null;
  completedAt: Date;
  manifestJson: string;
  resourceDefinitionJson: string;
  sizeBytes: number | null;
  stderrSummary: string;
  stdoutSummary: string;
}

export interface FailResourceBackupInput {
  backupId: string;
  completedAt: Date;
  failureSummary: string;
  manifestJson?: string | undefined;
  stderrSummary: string;
  stdoutSummary: string;
}

export interface MarkResourceBackupRetentionDeletedInput {
  backupId: string;
  retentionDeletedAt: Date;
  retentionReason: string;
}

export interface RecordResourceBackupRetentionFailureInput {
  backupId: string;
  failedAt: Date;
  failureSummary: string;
  retryInitialDelayMs: number;
  retryMaxDelayMs: number;
}
