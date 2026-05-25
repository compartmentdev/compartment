import { createHash } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isMissingFileSystemEntryError } from '@compartment/utils';
import { getApiConfig } from '../../runtime/runtime-access';
import { chmodPrivateRuntimeStorageFile, privateRuntimeFileMode } from '../private-runtime-storage-permissions.service';

interface StoredSourceResolutionTaskArchive {
  byteSize: number;
  sourceDigest: string;
}

export async function storeSourceResolutionTaskArchive(
  taskId: string,
  sourceArchive: Buffer,
): Promise<StoredSourceResolutionTaskArchive> {
  const archivePath: string = resolveSourceResolutionTaskArchivePath(taskId);
  await writeFile(archivePath, sourceArchive, { flag: 'wx', mode: privateRuntimeFileMode });
  await chmodPrivateRuntimeStorageFile(archivePath);

  return {
    byteSize: sourceArchive.byteLength,
    sourceDigest: createHash('sha256').update(sourceArchive).digest('hex'),
  };
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
