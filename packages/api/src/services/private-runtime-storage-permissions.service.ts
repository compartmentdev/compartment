import { chmodSync, constants, lstatSync, mkdirSync, type Stats } from 'node:fs';
import { chmod, lstat, open, readdir, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';

const privateRuntimeDirectoryMode: number = 0o700;
export const privateRuntimeFileMode: number = 0o600;
const noFollowReadFlags: number = constants.O_RDONLY | constants.O_NOFOLLOW;

export function ensurePrivateRuntimeStorageRootDirectorySync(directory: string): void {
  mkdirSync(directory, { mode: privateRuntimeDirectoryMode, recursive: true });
  chmodPrivateRuntimeStorageDirectorySync(directory);
}

export async function repairPrivateRuntimeStoragePermissions(path: string): Promise<void> {
  await repairPrivateRuntimeStoragePath(path);
}

export async function chmodPrivateRuntimeStorageFile(filePath: string): Promise<void> {
  await chmodPrivateRuntimeStorageFilePath(filePath);
}

async function repairPrivateRuntimeStoragePath(path: string): Promise<void> {
  const stats: Stats = await lstat(path);
  if (stats.isDirectory()) {
    await chmod(path, privateRuntimeDirectoryMode);
    for (const entry of await readdir(path)) {
      await repairPrivateRuntimeStoragePath(join(path, entry));
    }
    return;
  }
  if (stats.isFile()) {
    await chmodPrivateRuntimeStorageFilePath(path);
  }
}

async function chmodPrivateRuntimeStorageFilePath(filePath: string): Promise<void> {
  const file: FileHandle = await open(filePath, noFollowReadFlags);
  try {
    if ((await file.stat()).isFile()) {
      await file.chmod(privateRuntimeFileMode);
    }
  } finally {
    await file.close();
  }
}

function chmodPrivateRuntimeStorageDirectorySync(directory: string): void {
  if (!lstatSync(directory).isDirectory()) {
    throw new Error(`Private runtime storage path ${directory} is not a directory.`);
  }
  chmodSync(directory, privateRuntimeDirectoryMode);
}
