import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { sourceSyncTasks } from '../db/schema';
import { getApiConfig, getApiDatabase } from '../runtime/runtime-access';
import { requirePersistedRow } from './persisted-row.query.shared';
import { parseSourceSyncClaimToken, type ParsedSourceSyncClaimToken } from './source-sync-claim-token.query.support';
import { findClaimableSourceSyncTaskIdForUpdate } from './source-sync-claim.query.support';
import type {
  CancelSourceSyncTasksBySourceInput,
  CompleteSourceSyncTaskInput,
  CreateSourceSyncTaskInput,
  FailSourceSyncTaskInput,
  PersistedSourceSyncTaskRow,
  ResetSourceSyncTaskToPendingInput,
  RetrySourceSyncTaskInput,
  SourceSyncMutationTransaction,
  SourceSyncReadExecutor,
  SourceSyncTaskRow,
  UpdateLiveSourceSyncTaskOptionsInput,
  SourceSyncWriteExecutor,
} from './source-sync.query.types';

export {
  listSourceSyncTaskCandidatesByTaskId,
  listSourceSyncTaskCandidatesByTaskIdWithExecutor,
  replaceSourceSyncTaskCandidates,
} from './source-sync-candidate.query';

export async function findSourceSyncTaskById(taskId: string): Promise<SourceSyncTaskRow | undefined> {
  return await findSourceSyncTaskByIdWithExecutor(getApiDatabase(), taskId);
}

export async function findSourceSyncTaskByIdWithExecutor(
  executor: SourceSyncReadExecutor,
  taskId: string,
): Promise<SourceSyncTaskRow | undefined> {
  const rows: PersistedSourceSyncTaskRow[] = await executor
    .select()
    .from(sourceSyncTasks)
    .where(eq(sourceSyncTasks.id, taskId))
    .limit(1);

  return rows[0];
}

export async function findLatestSourceSyncTaskBySourceIdWithExecutor(
  executor: SourceSyncReadExecutor,
  sourceId: string,
): Promise<SourceSyncTaskRow | undefined> {
  const rows: PersistedSourceSyncTaskRow[] = await executor
    .select()
    .from(sourceSyncTasks)
    .where(eq(sourceSyncTasks.sourceId, sourceId))
    .orderBy(desc(sourceSyncTasks.createdAt), desc(sourceSyncTasks.id))
    .limit(1);

  return rows[0];
}

export async function createSourceSyncTask(
  executor: SourceSyncWriteExecutor,
  input: CreateSourceSyncTaskInput,
): Promise<SourceSyncTaskRow> {
  const [task]: PersistedSourceSyncTaskRow[] = await executor.insert(sourceSyncTasks).values(input).returning();
  return requirePersistedRow(task, 'source sync task');
}

export async function resetSourceSyncTaskToPending(
  executor: SourceSyncWriteExecutor,
  input: ResetSourceSyncTaskToPendingInput,
): Promise<SourceSyncTaskRow> {
  const [task]: PersistedSourceSyncTaskRow[] = await executor
    .update(sourceSyncTasks)
    .set(buildResetSourceSyncTaskToPendingValues(input))
    .where(and(eq(sourceSyncTasks.id, input.id), inArray(sourceSyncTasks.status, ['failed', 'canceled'])))
    .returning();

  return requirePersistedRow(task, 'source sync task');
}

export async function updateLiveSourceSyncTaskOptions(
  executor: SourceSyncWriteExecutor,
  input: UpdateLiveSourceSyncTaskOptionsInput,
): Promise<SourceSyncTaskRow> {
  const [task]: PersistedSourceSyncTaskRow[] = await executor
    .update(sourceSyncTasks)
    .set({
      adoptionMode: input.adoptionMode,
      requestedByPrincipalId: input.requestedByPrincipalId,
      requestedDescriptorPathsJson: input.requestedDescriptorPathsJson,
      ...(input.triggerCommitSha !== undefined ? { triggerCommitSha: input.triggerCommitSha } : {}),
      ...(input.triggerSourceEventId !== undefined ? { triggerSourceEventId: input.triggerSourceEventId } : {}),
      updatedAt: input.updatedAt,
    })
    .where(and(eq(sourceSyncTasks.id, input.id), inArray(sourceSyncTasks.status, ['pending', 'claimed'])))
    .returning();

  return requirePersistedRow(task, 'source sync task');
}

export async function claimNextSourceSyncTask(
  claimedByWorkerId: string,
  now: Date,
  leaseExpiresAt: Date,
): Promise<SourceSyncTaskRow | null> {
  return await getApiDatabase().transaction(
    async (tx: SourceSyncMutationTransaction): Promise<SourceSyncTaskRow | null> => {
      const taskId: string | undefined = await findClaimableSourceSyncTaskIdForUpdate(tx);
      if (taskId === undefined) {
        return null;
      }

      return await claimSourceSyncTaskWithExecutor(tx, taskId, claimedByWorkerId, now, leaseExpiresAt);
    },
  );
}

async function claimSourceSyncTaskWithExecutor(
  executor: SourceSyncMutationTransaction,
  taskId: string,
  claimedByWorkerId: string,
  now: Date,
  leaseExpiresAt: Date,
): Promise<SourceSyncTaskRow> {
  const [task]: PersistedSourceSyncTaskRow[] = await executor
    .update(sourceSyncTasks)
    .set({
      attemptCount: sql`${sourceSyncTasks.attemptCount} + 1`,
      claimedAt: now,
      claimedByWorkerId,
      leaseExpiresAt,
      status: 'claimed',
      updatedAt: now,
    })
    .where(eq(sourceSyncTasks.id, taskId))
    .returning();

  return requirePersistedRow(task, 'source sync task');
}

export async function completeSourceSyncTask(
  executor: SourceSyncWriteExecutor,
  input: CompleteSourceSyncTaskInput,
): Promise<SourceSyncTaskRow | null> {
  const [task]: PersistedSourceSyncTaskRow[] = await executor
    .update(sourceSyncTasks)
    .set({
      claimedAt: null,
      claimedByWorkerId: null,
      completedAt: input.completedAt,
      failureReason: null,
      leaseExpiresAt: null,
      resolvedCommitSha: input.resolvedCommitSha,
      status: 'completed',
      updatedAt: input.updatedAt,
    })
    .where(buildClaimedSourceSyncTaskMutationWhere(input.id, input.claimToken))
    .returning();

  return task ?? null;
}

export async function failSourceSyncTask(
  executor: SourceSyncWriteExecutor,
  input: FailSourceSyncTaskInput,
): Promise<SourceSyncTaskRow | null> {
  const [task]: PersistedSourceSyncTaskRow[] = await executor
    .update(sourceSyncTasks)
    .set({
      claimedAt: null,
      claimedByWorkerId: null,
      completedAt: input.completedAt,
      failureReason: input.failureReason,
      leaseExpiresAt: null,
      status: 'failed',
      updatedAt: input.updatedAt,
    })
    .where(buildClaimedSourceSyncTaskMutationWhere(input.id, input.claimToken))
    .returning();

  return task ?? null;
}

export async function retrySourceSyncTask(
  executor: SourceSyncWriteExecutor,
  input: RetrySourceSyncTaskInput,
): Promise<SourceSyncTaskRow | null> {
  const [task]: PersistedSourceSyncTaskRow[] = await executor
    .update(sourceSyncTasks)
    .set({
      claimedAt: null,
      claimedByWorkerId: null,
      completedAt: null,
      failureReason: input.failureReason,
      leaseExpiresAt: null,
      status: 'pending',
      updatedAt: input.updatedAt,
    })
    .where(buildClaimedSourceSyncTaskMutationWhere(input.id, input.claimToken))
    .returning();

  return task ?? null;
}

export async function cancelNonTerminalSourceSyncTasksBySource(
  executor: SourceSyncWriteExecutor,
  input: CancelSourceSyncTasksBySourceInput,
): Promise<void> {
  await executor
    .update(sourceSyncTasks)
    .set({
      claimedAt: null,
      claimedByWorkerId: null,
      completedAt: input.completedAt,
      failureReason: input.failureReason,
      leaseExpiresAt: null,
      status: 'canceled',
      updatedAt: input.updatedAt,
    })
    .where(and(eq(sourceSyncTasks.sourceId, input.sourceId), inArray(sourceSyncTasks.status, ['pending', 'claimed'])));
}

function buildResetSourceSyncTaskToPendingValues(
  input: ResetSourceSyncTaskToPendingInput,
): Partial<PersistedSourceSyncTaskRow> {
  return {
    adoptionMode: input.adoptionMode,
    attemptCount: 0,
    claimedAt: null,
    claimedByWorkerId: null,
    completedAt: null,
    failureReason: null,
    leaseExpiresAt: null,
    requestedByPrincipalId: input.requestedByPrincipalId,
    requestedBranchName: input.requestedBranchName,
    requestedDescriptorPathsJson: input.requestedDescriptorPathsJson,
    resolvedCommitSha: null,
    ...(input.triggerCommitSha !== undefined ? { triggerCommitSha: input.triggerCommitSha } : {}),
    ...(input.triggerSourceEventId !== undefined ? { triggerSourceEventId: input.triggerSourceEventId } : {}),
    status: 'pending',
    updatedAt: input.updatedAt,
  };
}

function buildClaimedSourceSyncTaskMutationWhere(id: string, claimToken: string): SQL {
  const parsedClaimToken: ParsedSourceSyncClaimToken | null = parseSourceSyncClaimToken(
    claimToken,
    getApiConfig().runtimeControlToken,
  );
  if (parsedClaimToken === null) {
    return sql`false`;
  }

  const condition: SQL | undefined = and(
    eq(sourceSyncTasks.id, id),
    eq(sourceSyncTasks.status, 'claimed'),
    eq(sourceSyncTasks.claimedByWorkerId, parsedClaimToken.claimedByWorkerId),
    eq(sourceSyncTasks.claimedAt, parsedClaimToken.claimedAt),
  );
  if (condition === undefined) {
    throw new Error('Expected source sync claim mutation condition to exist.');
  }

  return condition;
}
