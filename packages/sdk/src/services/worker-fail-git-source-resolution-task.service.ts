import {
  workerFailGitSourceResolutionTaskPathname,
  workerFailGitSourceResolutionTaskRequestSchema,
  type WorkerFailGitSourceResolutionTaskRequest,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function failGitSourceResolutionTask(
  request: CompartmentRequester,
  body: WorkerFailGitSourceResolutionTaskRequest,
): Promise<WorkerFailGitSourceResolutionTaskRequest> {
  return await request<WorkerFailGitSourceResolutionTaskRequest, WorkerFailGitSourceResolutionTaskRequest>({
    body,
    method: 'POST',
    path: workerFailGitSourceResolutionTaskPathname,
    schema: workerFailGitSourceResolutionTaskRequestSchema,
  });
}
