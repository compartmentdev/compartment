import type { GitSourceContextInput } from '../../services/git-source/git-source.service.types';

export interface BuildGitSourceSyncRequestedAuditEventInput {
  requestedBranchName: string;
  sourceDisplayName: string;
  sourceId: string;
  taskId: string;
}

export interface ReadGitSourceAuditDisplayNameInput extends GitSourceContextInput {
  sourceId: string;
}
