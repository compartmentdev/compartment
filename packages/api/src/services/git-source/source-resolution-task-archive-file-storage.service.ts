import { writeFile } from 'node:fs/promises';
import { chmodPrivateRuntimeStorageFile, privateRuntimeFileMode } from '../private-runtime-storage-permissions.service';
import { resolveSourceResolutionTaskArchivePath } from './source-resolution-task-archive-storage.service';

export async function storeSourceResolutionTaskArchive(taskId: string, sourceArchive: Buffer): Promise<void> {
  const archivePath: string = resolveSourceResolutionTaskArchivePath(taskId);
  await writeFile(archivePath, sourceArchive, { flag: 'wx', mode: privateRuntimeFileMode });
  await chmodPrivateRuntimeStorageFile(archivePath);
}
