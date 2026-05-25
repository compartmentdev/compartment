import { createInvalidSourceUploadError, isApiBusinessError } from '../errors/api-business-error';
import { deleteSourceUploadById, listExpiredUnusedSourceUploads } from '../queries/source-uploads.query';
import type { SourceUploadRow } from '../queries/source-uploads.query.types';
import { deleteSourceUploadArchive } from './source-upload-storage.service';
import type { CreatedSourceUpload, CreateSourceUploadStreamInput } from './source-uploads.service.types';

export class SourceUploadArchiveTooLargeError extends Error {
  constructor() {
    super('Uploaded source archive exceeded the configured size limit.');
    this.name = 'SourceUploadArchiveTooLargeError';
  }
}

export async function cleanupSourceUploadsBestEffort(now: Date, excludedSourceUploadId?: string): Promise<void> {
  try {
    await cleanupExpiredSourceUploads(now, excludedSourceUploadId);
  } catch {
    return;
  }
}

export async function deleteSourceUploadArchiveBestEffort(sourceUploadId: string): Promise<void> {
  try {
    await deleteSourceUploadArchive(sourceUploadId);
  } catch {
    return;
  }
}

export function throwIfSourceArchiveTruncated(input: CreateSourceUploadStreamInput): void {
  if (input.isTruncated?.() !== true) {
    return;
  }

  throw new SourceUploadArchiveTooLargeError();
}

export function toSourceUploadValidationError(error: Error | undefined): Error {
  if (error !== undefined && isApiBusinessError(error)) {
    return error;
  }

  return createInvalidSourceUploadError(error?.message);
}

export function toCreatedSourceUpload(sourceUpload: SourceUploadRow): CreatedSourceUpload {
  return {
    byteSize: sourceUpload.byteSize,
    createdAt: sourceUpload.createdAt,
    environmentId: sourceUpload.environmentId,
    expiresAt: sourceUpload.expiresAt,
    id: sourceUpload.id,
    projectId: sourceUpload.projectId,
    projectServiceId: sourceUpload.projectServiceId,
    sourceDigest: sourceUpload.sourceDigest,
  };
}

async function cleanupExpiredSourceUploads(now: Date, excludedSourceUploadId?: string): Promise<void> {
  const expiredUploads: SourceUploadRow[] = await listExpiredUnusedSourceUploads(now);

  for (const expiredUpload of expiredUploads) {
    if (expiredUpload.id === excludedSourceUploadId) {
      continue;
    }

    await deleteSourceUploadArchive(expiredUpload.id);
    await deleteSourceUploadById(expiredUpload.id);
  }
}
