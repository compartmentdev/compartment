import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { isMissingFileSystemEntryError } from '@compartment/utils';
import { getApiConfig } from '../../runtime/runtime-access';
import { validateSourceUploadArchive } from '../deployment-source-build-validation-archive.service';
import { storeSourceResolutionTaskArchive } from './source-resolution-task-archive-file-storage.service';

interface StoredSourceResolutionTaskArchive {
  byteSize: number;
  sourceDigest: string;
}

export class SourceResolutionTaskArchiveDigestMismatchError extends Error {
  public constructor() {
    super('Source archive logical digest does not match the uploaded digest.');
    this.name = 'SourceResolutionTaskArchiveDigestMismatchError';
  }
}

export async function storeVerifiedSourceResolutionTaskArchive(
  taskId: string,
  sourceArchive: Buffer,
  expectedSourceDigest: string,
): Promise<StoredSourceResolutionTaskArchive> {
  await storeSourceResolutionTaskArchive(taskId, sourceArchive);
  const archivePath: string = resolveSourceResolutionTaskArchivePath(taskId);

  try {
    const sourceDigest: string = await validateSourceUploadArchive(archivePath);
    if (sourceDigest !== expectedSourceDigest) {
      throw new SourceResolutionTaskArchiveDigestMismatchError();
    }

    return {
      byteSize: sourceArchive.byteLength,
      sourceDigest,
    };
  } catch (error) {
    await deleteSourceResolutionTaskArchive(taskId);
    throw error;
  }
}

export async function deleteSourceResolutionTaskArchive(taskId: string): Promise<void> {
  try {
    await unlink(resolveSourceResolutionTaskArchivePath(taskId));
  } catch (error) {
    if (!(error instanceof Error) || !isMissingFileSystemEntryError(error)) {
      throw error;
    }
  }
}

export function resolveSourceResolutionTaskArchivePath(taskId: string): string {
  return join(getApiConfig().sourceArchiveDirectory, `${sanitizeSourceResolutionTaskId(taskId)}.resolution.tgz`);
}

function sanitizeSourceResolutionTaskId(taskId: string): string {
  return taskId.replace(/[^a-zA-Z0-9._-]/g, '_');
}
