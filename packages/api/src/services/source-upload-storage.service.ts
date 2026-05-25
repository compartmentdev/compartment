import { createHash, type Hash } from 'node:crypto';
import { constants, createWriteStream, type WriteStream } from 'node:fs';
import { copyFile, link, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { finished } from 'node:stream/promises';
import { isMissingFileSystemEntryError } from '@compartment/utils';
import { getApiConfig } from '../runtime/runtime-access';
import {
  assertPrivateRuntimeStoragePath,
  isPrivateRuntimeStorageEntryNotFoundError,
  readPrivateRuntimeStorageFile,
} from './private-runtime-storage-boundary.service';
import { chmodPrivateRuntimeStorageFile, privateRuntimeFileMode } from './private-runtime-storage-permissions.service';
import type { StoredSourceUploadArchive } from './source-upload-storage.service.types';

export async function storeSourceUploadArchive(
  sourceUploadId: string,
  stream: NodeJS.ReadableStream,
): Promise<StoredSourceUploadArchive> {
  const tempPath: string = resolveSourceUploadArchivePath(`${sourceUploadId}.upload`);
  const finalPath: string = resolveSourceUploadArchivePath(sourceUploadId);
  const storageRoot: string = getApiConfig().sourceArchiveDirectory;
  await assertPrivateRuntimeStoragePath({
    label: 'Source upload archive temporary file',
    path: tempPath,
    storageRoot,
  });
  await assertPrivateRuntimeStoragePath({
    label: 'Source upload archive',
    path: finalPath,
    storageRoot,
  });
  const storedArchive: StoredSourceUploadArchive = await writeSourceUploadArchiveFile(tempPath, stream);

  await publishSourceUploadArchiveFile(tempPath, finalPath);

  return storedArchive;
}

async function writeSourceUploadArchiveFile(
  tempPath: string,
  stream: NodeJS.ReadableStream,
): Promise<StoredSourceUploadArchive> {
  const hash: Hash = createHash('sha256');
  const writeStream: WriteStream = createWriteStream(tempPath, { flags: 'wx', mode: privateRuntimeFileMode });

  try {
    const byteSize: number = await writeSourceUploadStream(stream, writeStream, hash);
    await finalizeSourceUploadWrite(writeStream);

    return {
      byteSize,
      sourceDigest: hash.digest('hex'),
    };
  } catch (error) {
    writeStream.destroy();
    await deleteArchiveFileSafely(tempPath);
    throw error;
  }
}

export async function readSourceUploadArchive(sourceUploadId: string): Promise<Buffer> {
  const path: string = resolveSourceUploadArchivePath(sourceUploadId);
  try {
    return await readPrivateRuntimeStorageFile({
      label: 'Source upload archive',
      path,
      storageRoot: getApiConfig().sourceArchiveDirectory,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (isMissingFileSystemEntryError(error) || isPrivateRuntimeStorageEntryNotFoundError(error))
    ) {
      throw new SourceUploadArchiveNotFoundError(sourceUploadId);
    }

    throw error;
  }
}

export async function deleteSourceUploadArchive(sourceUploadId: string): Promise<void> {
  await deleteArchiveFileSafely(resolveSourceUploadArchivePath(sourceUploadId));
}

export async function copySourceUploadArchiveFromPath(
  sourceUploadId: string,
  sourceArchivePath: string,
): Promise<void> {
  const targetPath: string = resolveSourceUploadArchivePath(sourceUploadId);
  await assertPrivateRuntimeStoragePath({
    label: 'Source upload archive',
    path: targetPath,
    storageRoot: getApiConfig().sourceArchiveDirectory,
  });
  await copyFile(sourceArchivePath, targetPath, constants.COPYFILE_EXCL);
  await chmodPrivateRuntimeStorageFile(targetPath);
}

async function publishSourceUploadArchiveFile(tempPath: string, finalPath: string): Promise<void> {
  let linked: boolean = false;
  try {
    await link(tempPath, finalPath);
    linked = true;
    await chmodPrivateRuntimeStorageFile(finalPath);
  } catch (error) {
    if (linked) {
      await deleteArchiveFileSafely(finalPath);
    }
    throw error;
  } finally {
    await deleteArchiveFileSafely(tempPath);
  }
}

async function writeSourceUploadStream(
  stream: NodeJS.ReadableStream,
  writeStream: WriteStream,
  hash: Hash,
): Promise<number> {
  let byteSize: number = 0;

  for await (const chunk of stream) {
    byteSize += await writeSourceUploadChunk(writeStream, hash, chunk);
  }

  return byteSize;
}

async function writeSourceUploadChunk(writeStream: WriteStream, hash: Hash, chunk: Buffer | string): Promise<number> {
  const buffer: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  hash.update(buffer);
  if (!writeStream.write(buffer)) {
    await onceStreamDrained(writeStream);
  }

  return buffer.length;
}

async function onceStreamDrained(stream: NodeJS.WritableStream): Promise<void> {
  await new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => {
    const handleDrain: () => void = (): void => {
      stream.off('error', handleError);
      resolve();
    };
    const handleError: (error: Error) => void = (error: Error): void => {
      stream.off('drain', handleDrain);
      reject(error);
    };

    stream.once('drain', handleDrain);
    stream.once('error', handleError);
  });
}

async function finalizeSourceUploadWrite(writeStream: WriteStream): Promise<void> {
  writeStream.end();
  await finished(writeStream);
}

async function deleteArchiveFileSafely(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    if (!(error instanceof Error) || !isMissingFileSystemEntryError(error)) {
      throw error;
    }
  }
}

export class SourceUploadArchiveNotFoundError extends Error {
  constructor(sourceUploadId: string) {
    super(`Source archive for source upload ${sourceUploadId} was not found.`);
    this.name = 'SourceUploadArchiveNotFoundError';
  }
}

export function resolveSourceUploadArchivePath(sourceUploadId: string): string {
  return join(getApiConfig().sourceArchiveDirectory, `${sanitizeSourceUploadId(sourceUploadId)}.tgz`);
}

function sanitizeSourceUploadId(sourceUploadId: string): string {
  return sourceUploadId.replace(/[^a-zA-Z0-9._-]/g, '_');
}
