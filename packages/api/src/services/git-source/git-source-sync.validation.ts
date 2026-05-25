import { createGitSourceNotFoundError } from '../../errors/api-business-error';
import type { SourceSyncTaskRow } from '../../queries/source-sync.query.types';

export function requireSourceSyncTask(task: SourceSyncTaskRow | undefined): SourceSyncTaskRow {
  if (task === undefined) {
    throw createGitSourceNotFoundError();
  }

  return task;
}

export function assertSourceSyncTaskOwnership(sourceId: string, task: SourceSyncTaskRow): void {
  if (task.sourceId !== sourceId) {
    throw createGitSourceNotFoundError();
  }
}
