import { and, eq, type SQL } from 'drizzle-orm';
import { sourceResolutionTasks } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import { requirePersistedRow } from './persisted-row.query.shared';
import { buildNonTerminalSourceResolutionTaskStatusFilter } from './source-resolution.query.support';
import { findClaimableSourceResolutionTaskIdForUpdate } from './source-resolution-claim.query';
import {
  insertSourceResolutionTask,
  markSourceResolutionTaskClaimed,
  updateExistingSourceResolutionTaskToPending,
  updateSourceResolutionTaskToCompleted,
  updateSourceResolutionTaskToFailed,
  updateSourceResolutionTaskToPending,
} from './source-resolution-task-mutation.query';
import type {
  CancelSourceResolutionTasksByBindingInput,
  CancelSourceResolutionTasksBySourceInput,
  CompleteSourceResolutionTaskInput,
  CreateOrRequeueSourceResolutionTaskResult,
  CreateSourceResolutionTaskInput,
  FailSourceResolutionTaskInput,
  PersistedSourceResolutionTaskRow,
  RetrySourceResolutionTaskInput,
  SourceResolutionMutationTransaction,
  SourceResolutionTaskRow,
  SourceResolutionWriteExecutor,
} from './source-resolution.query.types';

export async function claimNextSourceResolutionTask(
  claimantId: string,
  now: Date,
  leaseExpiresAt: Date,
): Promise<SourceResolutionTaskRow | null> {
  return await getApiDatabase().transaction(
    async (tx: SourceResolutionMutationTransaction): Promise<SourceResolutionTaskRow | null> => {
      const taskId: string | undefined = await findClaimableSourceResolutionTaskIdForUpdate(tx);
      return taskId === undefined
        ? null
        : await markSourceResolutionTaskClaimed(tx, taskId, claimantId, now, leaseExpiresAt);
    },
  );
}

export async function createOrRequeueSourceResolutionTask(
  executor: SourceResolutionWriteExecutor,
  input: CreateSourceResolutionTaskInput,
): Promise<CreateOrRequeueSourceResolutionTaskResult> {
  const created: SourceResolutionTaskRow | undefined = await insertSourceResolutionTask(executor, input);
  if (created !== undefined) {
    return buildSourceResolutionTaskQueueResult(created, true);
  }

  return await createExistingSourceResolutionTaskQueueResult(
    executor,
    input,
    await requireExistingSourceResolutionTask(input),
  );
}

async function createExistingSourceResolutionTaskQueueResult(
  executor: SourceResolutionWriteExecutor,
  input: CreateSourceResolutionTaskInput,
  existing: SourceResolutionTaskRow,
): Promise<CreateOrRequeueSourceResolutionTaskResult> {
  if (existing.status === 'failed' || existing.status === 'canceled') {
    return buildSourceResolutionTaskQueueResult(
      await updateExistingSourceResolutionTaskToPending(executor, existing.id, input),
      true,
    );
  }

  return buildSourceResolutionTaskQueueResult(existing, false);
}

async function requireExistingSourceResolutionTask(
  input: CreateSourceResolutionTaskInput,
): Promise<SourceResolutionTaskRow> {
  return requirePersistedRow(
    await findSourceResolutionTaskByBindingCommitAndEnvironment(
      input.sourceBindingId,
      input.commitSha,
      input.targetEnvironmentName,
    ),
    'source resolution task',
  );
}

function buildSourceResolutionTaskQueueResult(
  task: SourceResolutionTaskRow,
  queuedForEvent: boolean,
): CreateOrRequeueSourceResolutionTaskResult {
  return {
    queuedForEvent,
    task,
  };
}

export async function retrySourceResolutionTask(
  executor: SourceResolutionWriteExecutor,
  input: RetrySourceResolutionTaskInput,
): Promise<SourceResolutionTaskRow> {
  const retried: SourceResolutionTaskRow | undefined = await updateSourceResolutionTaskToPending(
    executor,
    input.id,
    input.failureReason,
    input.updatedAt,
  );

  return retried ?? (await requireCurrentSourceResolutionTask(input.id));
}

export async function completeSourceResolutionTask(
  executor: SourceResolutionWriteExecutor,
  input: CompleteSourceResolutionTaskInput,
): Promise<SourceResolutionTaskRow> {
  const completed: SourceResolutionTaskRow | undefined = await updateSourceResolutionTaskToCompleted(executor, input);

  return completed ?? (await requireCurrentSourceResolutionTask(input.id));
}

export async function failSourceResolutionTask(
  executor: SourceResolutionWriteExecutor,
  input: FailSourceResolutionTaskInput,
): Promise<SourceResolutionTaskRow> {
  const failed: SourceResolutionTaskRow | undefined = await updateSourceResolutionTaskToFailed(executor, input);

  return failed ?? (await requireCurrentSourceResolutionTask(input.id));
}

export async function cancelNonTerminalSourceResolutionTasksBySource(
  executor: SourceResolutionWriteExecutor,
  input: CancelSourceResolutionTasksBySourceInput,
): Promise<void> {
  await cancelSourceResolutionTasksWithFilter(
    executor,
    input,
    and(eq(sourceResolutionTasks.sourceId, input.sourceId), buildNonTerminalSourceResolutionTaskStatusFilter())!,
  );
}

export async function cancelNonTerminalSourceResolutionTasksByBinding(
  executor: SourceResolutionWriteExecutor,
  input: CancelSourceResolutionTasksByBindingInput,
): Promise<void> {
  await cancelSourceResolutionTasksWithFilter(
    executor,
    input,
    and(
      eq(sourceResolutionTasks.sourceBindingId, input.sourceBindingId),
      buildNonTerminalSourceResolutionTaskStatusFilter(),
    )!,
  );
}

async function cancelSourceResolutionTasksWithFilter(
  executor: SourceResolutionWriteExecutor,
  input: CancelSourceResolutionTasksBySourceInput | CancelSourceResolutionTasksByBindingInput,
  filter: SQL,
): Promise<void> {
  await executor.update(sourceResolutionTasks).set(buildCanceledSourceResolutionTaskValues(input)).where(filter);
}

function buildCanceledSourceResolutionTaskValues(
  input: CancelSourceResolutionTasksBySourceInput | CancelSourceResolutionTasksByBindingInput,
): Partial<PersistedSourceResolutionTaskRow> {
  return {
    claimedAt: null,
    claimantId: null,
    completedAt: input.completedAt,
    failureReason: input.failureReason,
    leaseExpiresAt: null,
    status: 'canceled',
    updatedAt: input.updatedAt,
  };
}

async function findSourceResolutionTaskByBindingCommitAndEnvironment(
  sourceBindingId: string,
  commitSha: string,
  targetEnvironmentName: string,
): Promise<SourceResolutionTaskRow | undefined> {
  const rows: PersistedSourceResolutionTaskRow[] = await getApiDatabase()
    .select()
    .from(sourceResolutionTasks)
    .where(
      and(
        eq(sourceResolutionTasks.sourceBindingId, sourceBindingId),
        eq(sourceResolutionTasks.commitSha, commitSha),
        eq(sourceResolutionTasks.targetEnvironmentName, targetEnvironmentName),
      ),
    )
    .limit(1);

  return rows[0];
}

async function requireCurrentSourceResolutionTask(taskId: string): Promise<SourceResolutionTaskRow> {
  return requirePersistedRow(await findSourceResolutionTaskById(taskId), 'source resolution task');
}

export async function findSourceResolutionTaskById(taskId: string): Promise<SourceResolutionTaskRow | undefined> {
  const rows: PersistedSourceResolutionTaskRow[] = await getApiDatabase()
    .select()
    .from(sourceResolutionTasks)
    .where(eq(sourceResolutionTasks.id, taskId))
    .limit(1);

  return rows[0];
}
