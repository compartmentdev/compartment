import type { GitSourceSyncCandidateStatus } from '@compartment/contracts';
import type { Actor } from '../auth-actor.types';
import type { GitSourceLatestSyncView } from './git-source.service.types';

export interface GitSourceSyncContextInput {
  actor: Actor;
  organizationId: string;
  sourceId: string;
}

export interface ReadGitSourceSyncTaskInput extends GitSourceSyncContextInput {
  taskId: string;
}

export interface GitSourceSyncCandidateView {
  blockedReason: string | null;
  derivedWatchPaths: string[];
  descriptorDirectory: string;
  descriptorPath: string;
  id: string;
  projectName: string | null;
  status: GitSourceSyncCandidateStatus;
}

export type GitSourceSyncTaskView = GitSourceLatestSyncView;
