import {
  workerClaimGitSourceResolutionTaskResponseSchema,
  workerClaimNextGitSourceResolutionTaskPathname,
  type WorkerClaimGitSourceResolutionTaskResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function claimNextGitSourceResolutionTask(
  request: CompartmentRequester,
): Promise<WorkerClaimGitSourceResolutionTaskResponse> {
  return await request<WorkerClaimGitSourceResolutionTaskResponse, undefined>({
    method: 'POST',
    path: workerClaimNextGitSourceResolutionTaskPathname,
    schema: workerClaimGitSourceResolutionTaskResponseSchema,
  });
}
