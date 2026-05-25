import type { WorkerCompleteGitSourceSyncTaskRequest } from '@compartment/contracts';
import type { SourceMutationTransaction, SourceRow } from '../../queries/source.query.types';
import { completeSourceSyncTask, findSourceSyncTaskByIdWithExecutor } from '../../queries/source-sync.query';
import type { CompleteSourceSyncTaskInput, SourceSyncTaskRow } from '../../queries/source-sync.query.types';
import {
  buildSourceSyncCandidateResolutionContext,
  type SourceSyncCandidateResolutionContext,
} from './git-source-sync-completion.context';
import { requireSourceSyncTask } from './git-source-sync.validation';

export interface FencedSourceSyncCompletion {
  completedTask: SourceSyncTaskRow;
  liveTask: SourceSyncTaskRow;
  resolutionContext: SourceSyncCandidateResolutionContext;
}

export async function resolveFencedSourceSyncCompletion(
  transaction: SourceMutationTransaction,
  task: SourceSyncTaskRow,
  source: SourceRow,
  input: WorkerCompleteGitSourceSyncTaskRequest,
  now: Date,
): Promise<FencedSourceSyncCompletion | null> {
  const liveTask: SourceSyncTaskRow = requireSourceSyncTask(
    await findSourceSyncTaskByIdWithExecutor(transaction, task.id),
  );
  const resolutionContext: SourceSyncCandidateResolutionContext = await buildSourceSyncCandidateResolutionContext(
    transaction,
    liveTask,
    source,
    input.resolvedCommitSha,
    now,
  );
  const completedTask: SourceSyncTaskRow | null = await completeSourceSyncTask(
    transaction,
    buildCompleteSourceSyncTaskInput(liveTask.id, input, now),
  );

  return completedTask === null ? null : { completedTask, liveTask, resolutionContext };
}

function buildCompleteSourceSyncTaskInput(
  taskId: string,
  input: WorkerCompleteGitSourceSyncTaskRequest,
  now: Date,
): CompleteSourceSyncTaskInput {
  return {
    claimToken: input.claimToken,
    completedAt: now,
    id: taskId,
    resolvedCommitSha: input.resolvedCommitSha,
    updatedAt: now,
  };
}
