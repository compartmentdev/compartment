import { and, eq, sql } from 'drizzle-orm';
import { sourceResolutionTasks } from '../db/schema';
import { requirePersistedRow } from './persisted-row.query.shared';
import { buildNonTerminalSourceResolutionTaskStatusFilter } from './source-resolution.query.support';
import type {
  CompleteSourceResolutionTaskInput,
  CreateSourceResolutionTaskInput,
  FailSourceResolutionTaskInput,
  PersistedSourceResolutionTaskRow,
  SourceResolutionTaskRow,
  SourceResolutionWriteExecutor,
} from './source-resolution.query.types';

export async function markSourceResolutionTaskClaimed(
  executor: SourceResolutionWriteExecutor,
  taskId: string,
  claimantId: string,
  now: Date,
  leaseExpiresAt: Date,
): Promise<SourceResolutionTaskRow> {
  const [task]: PersistedSourceResolutionTaskRow[] = await executor
    .update(sourceResolutionTasks)
    .set({
      attemptCount: sql`${sourceResolutionTasks.attemptCount} + 1`,
      claimedAt: now,
      claimantId,
      leaseExpiresAt,
      status: 'claimed',
      updatedAt: now,
    })
    .where(eq(sourceResolutionTasks.id, taskId))
    .returning();

  return requirePersistedRow(task, 'source resolution task');
}

export async function insertSourceResolutionTask(
  executor: SourceResolutionWriteExecutor,
  input: CreateSourceResolutionTaskInput,
): Promise<SourceResolutionTaskRow | undefined> {
  const [task]: PersistedSourceResolutionTaskRow[] = await executor
    .insert(sourceResolutionTasks)
    .values(input)
    .onConflictDoNothing({
      target: [
        sourceResolutionTasks.sourceBindingId,
        sourceResolutionTasks.commitSha,
        sourceResolutionTasks.targetEnvironmentName,
      ],
    })
    .returning();

  return task;
}

export async function updateExistingSourceResolutionTaskToPending(
  executor: SourceResolutionWriteExecutor,
  taskId: string,
  input: CreateSourceResolutionTaskInput,
): Promise<SourceResolutionTaskRow> {
  const [task]: PersistedSourceResolutionTaskRow[] = await executor
    .update(sourceResolutionTasks)
    .set({
      attemptCount: 0,
      branchName: input.branchName,
      claimedAt: null,
      claimantId: null,
      completedAt: null,
      failureReason: null,
      leaseExpiresAt: null,
      sourceEventId: input.sourceEventId,
      status: 'pending',
      updatedAt: input.updatedAt,
    })
    .where(eq(sourceResolutionTasks.id, taskId))
    .returning();

  return requirePersistedRow(task, 'source resolution task');
}

export async function updateSourceResolutionTaskToPending(
  executor: SourceResolutionWriteExecutor,
  taskId: string,
  failureReason: string,
  updatedAt: Date,
): Promise<SourceResolutionTaskRow | undefined> {
  const [task]: PersistedSourceResolutionTaskRow[] = await executor
    .update(sourceResolutionTasks)
    .set({
      claimedAt: null,
      claimantId: null,
      completedAt: null,
      failureReason,
      leaseExpiresAt: null,
      status: 'pending',
      updatedAt,
    })
    .where(and(eq(sourceResolutionTasks.id, taskId), eq(sourceResolutionTasks.status, 'claimed')))
    .returning();

  return task;
}

export async function updateSourceResolutionTaskToCompleted(
  executor: SourceResolutionWriteExecutor,
  input: CompleteSourceResolutionTaskInput,
): Promise<SourceResolutionTaskRow | undefined> {
  const [task]: PersistedSourceResolutionTaskRow[] = await executor
    .update(sourceResolutionTasks)
    .set({
      claimedAt: null,
      claimantId: null,
      completedAt: input.completedAt,
      failureReason: null,
      leaseExpiresAt: null,
      status: 'completed',
      updatedAt: input.updatedAt,
    })
    .where(and(eq(sourceResolutionTasks.id, input.id), buildNonTerminalSourceResolutionTaskStatusFilter()))
    .returning();

  return task;
}

export async function updateSourceResolutionTaskToFailed(
  executor: SourceResolutionWriteExecutor,
  input: FailSourceResolutionTaskInput,
): Promise<SourceResolutionTaskRow | undefined> {
  const [task]: PersistedSourceResolutionTaskRow[] = await executor
    .update(sourceResolutionTasks)
    .set({
      claimedAt: null,
      claimantId: null,
      completedAt: input.completedAt,
      failureReason: input.failureReason,
      leaseExpiresAt: null,
      status: 'failed',
      updatedAt: input.updatedAt,
    })
    .where(and(eq(sourceResolutionTasks.id, input.id), buildNonTerminalSourceResolutionTaskStatusFilter()))
    .returning();

  return task;
}
