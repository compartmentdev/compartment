import {
  workerClaimGitSourceSyncTaskResponseSchema,
  workerClaimNextGitSourceSyncTaskPathname,
  type WorkerClaimGitSourceSyncTaskResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function claimNextGitSourceSyncTask(
  request: CompartmentRequester,
): Promise<WorkerClaimGitSourceSyncTaskResponse> {
  return await request<WorkerClaimGitSourceSyncTaskResponse, undefined>({
    method: 'POST',
    path: workerClaimNextGitSourceSyncTaskPathname,
    schema: workerClaimGitSourceSyncTaskResponseSchema,
  });
}
