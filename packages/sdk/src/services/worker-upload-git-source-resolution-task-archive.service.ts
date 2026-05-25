import {
  buildWorkerUploadGitSourceResolutionTaskArchivePath,
  workerUploadGitSourceResolutionTaskArchiveResponseSchema,
  type WorkerUploadGitSourceResolutionTaskArchiveResponse,
} from '@compartment/contracts';
import type { CompartmentRawRequester } from '../http/request.types';

export async function uploadGitSourceResolutionTaskArchive(
  request: CompartmentRawRequester,
  taskId: string,
  sourceArchive: Uint8Array,
): Promise<WorkerUploadGitSourceResolutionTaskArchiveResponse> {
  return await request<WorkerUploadGitSourceResolutionTaskArchiveResponse>({
    body: sourceArchive,
    contentType: 'application/gzip',
    method: 'POST',
    path: buildWorkerUploadGitSourceResolutionTaskArchivePath(taskId),
    schema: workerUploadGitSourceResolutionTaskArchiveResponseSchema,
  });
}
