import type { SourceMutationTransaction, SourceRow } from '../../queries/source.query.types';
import { findSourceSyncTaskById, listSourceSyncTaskCandidatesByTaskId } from '../../queries/source-sync.query';
import type { SourceSyncTaskRow } from '../../queries/source-sync.query.types';
import { getApiDatabase } from '../../runtime/runtime-access';
import { assertSourceSyncTaskOwnership, requireSourceSyncTask } from './git-source-sync.validation';
import { readOrCreateGitSourceSyncTaskIdForStart } from './git-source-sync-task.service';
import { buildGitSourceSyncTaskView } from './git-source-sync.view.service';
import { requireActiveConnectedGitSourceForSync } from './git-source-sync.source-support';
import type {
  GitSourceSyncContextInput,
  GitSourceSyncTaskView,
  ReadGitSourceSyncTaskInput,
} from './git-source-sync.service.types';

export async function startGitSourceSync(input: GitSourceSyncContextInput): Promise<GitSourceSyncTaskView> {
  const source: SourceRow = await requireActiveConnectedGitSourceForSync(input);
  const taskId: string = await getApiDatabase().transaction(
    async (transaction: SourceMutationTransaction): Promise<string> =>
      await readOrCreateGitSourceSyncTaskIdForStart(transaction, source, input.actor.principalId),
  );

  return await readGitSourceSyncTask({
    ...input,
    taskId,
  });
}

export async function readGitSourceSyncTask(input: ReadGitSourceSyncTaskInput): Promise<GitSourceSyncTaskView> {
  const source: SourceRow = await requireActiveConnectedGitSourceForSync(input);
  const task: SourceSyncTaskRow = requireSourceSyncTask(await findSourceSyncTaskById(input.taskId));
  assertSourceSyncTaskOwnership(source.id, task);

  return buildGitSourceSyncTaskView(task, await listSourceSyncTaskCandidatesByTaskId(task.id));
}
