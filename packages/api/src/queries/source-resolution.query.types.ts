import type { ApiDatabaseTransaction } from '../db/client.types';
import type { Database } from '../db/client';
import type { sourceEvents, sourceResolutionTaskDeployments, sourceResolutionTasks } from '../db/schema';

export type SourceEventStatus = 'received' | 'tasks_created' | 'completed';
export type SourceEventType = 'push' | 'source_sync';
export type SourceResolutionTaskStatus = 'pending' | 'claimed' | 'completed' | 'failed' | 'canceled';
export type SourceResolutionReadExecutor = Pick<Database, 'select'>;
export type SourceResolutionWriteExecutor = Database | ApiDatabaseTransaction;
export type SourceResolutionMutationTransaction = ApiDatabaseTransaction;
export type PersistedSourceEventRow = typeof sourceEvents.$inferSelect;
export type PersistedSourceResolutionTaskRow = typeof sourceResolutionTasks.$inferSelect;
export type PersistedSourceResolutionTaskDeploymentRow = typeof sourceResolutionTaskDeployments.$inferSelect;

export interface SourceEventRow {
  branchName: string | null;
  changedFilesComplete: boolean;
  changedFilesJson: string;
  commitSha: string | null;
  completedAt: Date | null;
  createdAt: Date;
  eventType: SourceEventType;
  id: string;
  payloadJson: string;
  providerDeliveryId: string;
  sourceId: string;
  status: SourceEventStatus;
  updatedAt: Date;
}

export interface SourceResolutionTaskRow {
  attemptCount: number;
  branchName: string;
  claimedAt: Date | null;
  claimantId: string | null;
  commitSha: string;
  completedAt: Date | null;
  createdAt: Date;
  failureReason: string | null;
  id: string;
  leaseExpiresAt: Date | null;
  maxAttempts: number;
  sourceBindingId: string;
  sourceEventId: string;
  sourceId: string;
  status: SourceResolutionTaskStatus;
  targetEnvironmentName: string;
  updatedAt: Date;
}

export interface CreateOrRequeueSourceResolutionTaskResult {
  queuedForEvent: boolean;
  task: SourceResolutionTaskRow;
}

export interface SourceResolutionTaskDeploymentRow {
  createdAt: Date;
  deploymentId: string;
  id: string;
  sourceResolutionTaskId: string;
}

export interface CreateSourceEventInput {
  branchName?: string | null | undefined;
  changedFilesComplete: boolean;
  changedFilesJson: string;
  commitSha?: string | null | undefined;
  eventType: SourceEventType;
  id: string;
  payloadJson: string;
  providerDeliveryId: string;
  sourceId: string;
  status: SourceEventStatus;
  updatedAt: Date;
}

export interface CreateOrGetSourceEventResult {
  created: boolean;
  event: SourceEventRow;
}

export interface UpdateSourceEventStatusInput {
  completedAt?: Date | null | undefined;
  sourceEventId: string;
  status: SourceEventStatus;
  updatedAt: Date;
}

export interface CreateSourceResolutionTaskInput {
  branchName: string;
  commitSha: string;
  id: string;
  maxAttempts: number;
  sourceBindingId: string;
  sourceEventId: string;
  sourceId: string;
  status: SourceResolutionTaskStatus;
  targetEnvironmentName: string;
  updatedAt: Date;
}

export interface RetrySourceResolutionTaskInput {
  failureReason: string;
  id: string;
  updatedAt: Date;
}

export interface CompleteSourceResolutionTaskInput {
  completedAt: Date;
  id: string;
  updatedAt: Date;
}

export interface FailSourceResolutionTaskInput {
  completedAt: Date;
  failureReason: string;
  id: string;
  updatedAt: Date;
}

export interface CancelSourceResolutionTasksBySourceInput {
  completedAt: Date;
  failureReason: string;
  sourceId: string;
  updatedAt: Date;
}

export interface CancelSourceResolutionTasksByBindingInput {
  completedAt: Date;
  failureReason: string;
  sourceBindingId: string;
  updatedAt: Date;
}

export interface CreateSourceResolutionTaskDeploymentInput {
  deploymentId: string;
  id: string;
  sourceResolutionTaskId: string;
}
