import {
  workerCompleteGitSourceSyncTaskPathname,
  workerCompleteGitSourceSyncTaskRequestSchema,
  type WorkerCompleteGitSourceSyncTaskRequest,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function completeGitSourceSyncTask(
  request: CompartmentRequester,
  body: WorkerCompleteGitSourceSyncTaskRequest,
): Promise<WorkerCompleteGitSourceSyncTaskRequest> {
  return await request<WorkerCompleteGitSourceSyncTaskRequest, WorkerCompleteGitSourceSyncTaskRequest>({
    body,
    method: 'POST',
    path: workerCompleteGitSourceSyncTaskPathname,
    schema: workerCompleteGitSourceSyncTaskRequestSchema,
  });
}
