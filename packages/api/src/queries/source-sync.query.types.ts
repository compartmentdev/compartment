import type { GitSourceSyncCandidateStatus, GitSourceSyncTaskStatus } from '@compartment/contracts';
import type { Database } from '../db/client';
import type { ApiDatabaseTransaction } from '../db/client.types';
import type { sourceSyncTaskCandidates, sourceSyncTasks } from '../db/schema';

export type SourceSyncTaskAdoptionMode = 'bootstrap' | 'incremental';
export type SourceSyncTaskCandidateStatus = GitSourceSyncCandidateStatus;
export type SourceSyncTaskStatus = GitSourceSyncTaskStatus;
export type SourceSyncReadExecutor = Pick<Database, 'select'>;
export type SourceSyncWriteExecutor = Database | ApiDatabaseTransaction;
export type SourceSyncMutationTransaction = ApiDatabaseTransaction;
export type PersistedSourceSyncTaskRow = typeof sourceSyncTasks.$inferSelect;
export type PersistedSourceSyncTaskCandidateRow = typeof sourceSyncTaskCandidates.$inferSelect;

export interface SourceSyncTaskRow {
  adoptionMode: SourceSyncTaskAdoptionMode;
  attemptCount: number;
  claimedAt: Date | null;
  claimedByWorkerId: string | null;
  completedAt: Date | null;
  createdAt: Date;
  failureReason: string | null;
  id: string;
  leaseExpiresAt: Date | null;
  maxAttempts: number;
  requestedByPrincipalId: string;
  requestedBranchName: string;
  requestedDescriptorPathsJson: string;
  resolvedCommitSha: string | null;
  sourceId: string;
  status: SourceSyncTaskStatus;
  triggerCommitSha: string | null;
  triggerSourceEventId: string | null;
  updatedAt: Date;
}

export interface SourceSyncTaskCandidateRow {
  blockedReason: string | null;
  createdAt: Date;
  derivedWatchPathsJson: string;
  descriptorDirectory: string;
  descriptorPath: string;
  id: string;
  projectName: string | null;
  sourceSyncTaskId: string;
  status: SourceSyncTaskCandidateStatus;
  updatedAt: Date;
}

export interface CreateSourceSyncTaskInput {
  adoptionMode: SourceSyncTaskAdoptionMode;
  id: string;
  maxAttempts: number;
  requestedByPrincipalId: string;
  requestedBranchName: string;
  requestedDescriptorPathsJson: string;
  sourceId: string;
  status: SourceSyncTaskStatus;
  triggerCommitSha?: string | null | undefined;
  triggerSourceEventId?: string | null | undefined;
  updatedAt: Date;
}

export interface ResetSourceSyncTaskToPendingInput {
  adoptionMode: SourceSyncTaskAdoptionMode;
  id: string;
  requestedByPrincipalId: string;
  requestedBranchName: string;
  requestedDescriptorPathsJson: string;
  triggerCommitSha?: string | null | undefined;
  triggerSourceEventId?: string | null | undefined;
  updatedAt: Date;
}

export interface CompleteSourceSyncTaskInput {
  claimToken: string;
  completedAt: Date;
  id: string;
  resolvedCommitSha: string;
  updatedAt: Date;
}

export interface FailSourceSyncTaskInput {
  claimToken: string;
  completedAt: Date;
  failureReason: string;
  id: string;
  updatedAt: Date;
}

export interface UpdateLiveSourceSyncTaskOptionsInput {
  adoptionMode: SourceSyncTaskAdoptionMode;
  id: string;
  requestedByPrincipalId: string;
  requestedDescriptorPathsJson: string;
  triggerCommitSha?: string | null | undefined;
  triggerSourceEventId?: string | null | undefined;
  updatedAt: Date;
}

export interface RetrySourceSyncTaskInput {
  claimToken: string;
  failureReason: string;
  id: string;
  updatedAt: Date;
}

export interface CancelSourceSyncTasksBySourceInput {
  completedAt: Date;
  failureReason: string;
  sourceId: string;
  updatedAt: Date;
}

export interface CreateSourceSyncTaskCandidateInput {
  blockedReason?: string | null | undefined;
  derivedWatchPathsJson: string;
  descriptorDirectory: string;
  descriptorPath: string;
  id: string;
  projectName?: string | null | undefined;
  sourceSyncTaskId: string;
  status: SourceSyncTaskCandidateStatus;
  updatedAt: Date;
}
