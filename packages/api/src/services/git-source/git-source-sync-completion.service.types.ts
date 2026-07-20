import type { SourceSyncTaskRow } from '../../queries/source-sync.query.types';
import type { AuditEventResult } from '../audit-events.service.types';

export interface CompleteClaimedGitSourceSyncTaskResult {
  auditEvents: AuditEventResult[];
  completedTask: SourceSyncTaskRow;
}
