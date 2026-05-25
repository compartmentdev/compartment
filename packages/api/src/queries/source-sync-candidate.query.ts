import { asc, eq } from 'drizzle-orm';
import { sourceSyncTaskCandidates } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type {
  CreateSourceSyncTaskCandidateInput,
  PersistedSourceSyncTaskCandidateRow,
  SourceSyncReadExecutor,
  SourceSyncTaskCandidateRow,
  SourceSyncWriteExecutor,
} from './source-sync.query.types';

export async function replaceSourceSyncTaskCandidates(
  executor: SourceSyncWriteExecutor,
  taskId: string,
  inputs: readonly CreateSourceSyncTaskCandidateInput[],
): Promise<void> {
  await executor.delete(sourceSyncTaskCandidates).where(eq(sourceSyncTaskCandidates.sourceSyncTaskId, taskId));
  if (inputs.length === 0) {
    return;
  }

  await executor.insert(sourceSyncTaskCandidates).values([...inputs]);
}

export async function listSourceSyncTaskCandidatesByTaskId(taskId: string): Promise<SourceSyncTaskCandidateRow[]> {
  return await listSourceSyncTaskCandidatesByTaskIdWithExecutor(getApiDatabase(), taskId);
}

export async function listSourceSyncTaskCandidatesByTaskIdWithExecutor(
  executor: SourceSyncReadExecutor,
  taskId: string,
): Promise<SourceSyncTaskCandidateRow[]> {
  const rows: PersistedSourceSyncTaskCandidateRow[] = await executor
    .select()
    .from(sourceSyncTaskCandidates)
    .where(eq(sourceSyncTaskCandidates.sourceSyncTaskId, taskId))
    .orderBy(asc(sourceSyncTaskCandidates.createdAt), asc(sourceSyncTaskCandidates.id));

  return rows;
}
