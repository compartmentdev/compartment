import {
  buildCompartmentGitSourceSyncPathname,
  buildCompartmentGitSourceSyncTaskPathname,
  gitSourceSyncTaskResponseSchema,
  type GitSourceSyncTaskResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function startGitSourceSync(
  request: CompartmentRequester,
  sourceId: string,
): Promise<GitSourceSyncTaskResponse> {
  return await request<GitSourceSyncTaskResponse, undefined>({
    method: 'POST',
    path: buildCompartmentGitSourceSyncPathname(sourceId),
    schema: gitSourceSyncTaskResponseSchema,
  });
}

export async function getGitSourceSyncTask(
  request: CompartmentRequester,
  sourceId: string,
  taskId: string,
): Promise<GitSourceSyncTaskResponse> {
  return await request<GitSourceSyncTaskResponse, undefined>({
    method: 'GET',
    path: buildCompartmentGitSourceSyncTaskPathname(sourceId, taskId),
    schema: gitSourceSyncTaskResponseSchema,
  });
}
