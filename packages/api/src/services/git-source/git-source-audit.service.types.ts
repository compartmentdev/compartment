import type { AuditEventWriteExecutor } from '../../queries/audit-events.query.types';
import type { SourceBindingRow, SourceRow } from '../../queries/source.query.types';
import type { SourceSyncTaskRow } from '../../queries/source-sync.query.types';

export type GitSourceSyncAuditEventStatus = 'failed' | 'succeeded';

export interface BuildGitSourceSyncAuditEventInput {
  executor?: AuditEventWriteExecutor | undefined;
  resolvedCommitSha?: string | undefined;
  source: SourceRow;
  status: GitSourceSyncAuditEventStatus;
  task: SourceSyncTaskRow;
}

export interface BuildGitSourceBindingCreatedAuditEventInput {
  binding: SourceBindingRow;
  branchName: string;
  environmentName: string;
  executor?: AuditEventWriteExecutor | undefined;
  source: SourceRow;
}

export interface BuildGitSourcePushAuditEventInputsInput {
  branchName: string;
  changedFilesComplete: boolean;
  changedFilesCount: number;
  commitSha: string;
  executor?: AuditEventWriteExecutor | undefined;
  providerDeliveryId: string;
  resolutionTaskCount: number;
  source: SourceRow;
}
