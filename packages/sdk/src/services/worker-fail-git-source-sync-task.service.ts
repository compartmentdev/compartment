import {
  workerFailGitSourceSyncTaskPathname,
  workerFailGitSourceSyncTaskRequestSchema,
  type WorkerFailGitSourceSyncTaskRequest,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function failGitSourceSyncTask(
  request: CompartmentRequester,
  body: WorkerFailGitSourceSyncTaskRequest,
): Promise<WorkerFailGitSourceSyncTaskRequest> {
  return await request<WorkerFailGitSourceSyncTaskRequest, WorkerFailGitSourceSyncTaskRequest>({
    body,
    method: 'POST',
    path: workerFailGitSourceSyncTaskPathname,
    schema: workerFailGitSourceSyncTaskRequestSchema,
  });
}
