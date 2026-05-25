import {
  workerCompleteGitSourceResolutionTaskPathname,
  workerCompleteGitSourceResolutionTaskRequestSchema,
  type WorkerCompleteGitSourceResolutionTaskRequest,
  type WorkerCompleteGitSourceResolutionTaskRequestInput,
} from '@compartment/contracts';
import type { ZodType } from 'zod';
import type { CompartmentRequester } from '../http/request.types';

export async function completeGitSourceResolutionTask(
  request: CompartmentRequester,
  body: WorkerCompleteGitSourceResolutionTaskRequestInput,
): Promise<WorkerCompleteGitSourceResolutionTaskRequest> {
  const responseSchema: ZodType<WorkerCompleteGitSourceResolutionTaskRequest> =
    workerCompleteGitSourceResolutionTaskRequestSchema as ZodType<WorkerCompleteGitSourceResolutionTaskRequest>;
  return await request<WorkerCompleteGitSourceResolutionTaskRequest, WorkerCompleteGitSourceResolutionTaskRequestInput>(
    {
      body,
      method: 'POST',
      path: workerCompleteGitSourceResolutionTaskPathname,
      schema: responseSchema,
    },
  );
}
