import type { Stats } from 'node:fs';
import { chmod, chown, copyFile, lstat, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { isMissingFileSystemEntryError } from '@compartment/utils';
import {
  assertNoExistingSelfHostedDirectorySymlinks,
  assertRealSelfHostedDirectory,
} from './self-hosted-host-directories';

const selfHostedPrivateDirectoryMode: number = 0o700;
const selfHostedPrivateFileMode: number = 0o600;
const rootOwnedSelfHostedPathPrefixes: readonly string[] = [
  '/etc/compartment',
  '/run/compartment',
  '/var/lib/compartment',
  '/var/run/compartment',
].map((path: string): string => resolve(path));

export async function writeSelfHostedPrivateFile(filePath: string, contents: string): Promise<void> {
  await ensureSelfHostedPrivateDirectory(dirname(filePath));
  await assertWritableSelfHostedPrivateFileTarget(filePath);
  await writeFile(filePath, contents, {
    encoding: 'utf8',
    mode: selfHostedPrivateFileMode,
  });
  await assertRealSelfHostedPrivateFile(filePath);
  await applyRootOwnershipIfRoot(filePath);
  await chmod(filePath, selfHostedPrivateFileMode);
}

export async function copySelfHostedPrivateFile(sourcePath: string, destinationPath: string): Promise<void> {
  await ensureSelfHostedPrivateDirectory(dirname(destinationPath));
  await assertWritableSelfHostedPrivateFileTarget(destinationPath);
  await copyFile(sourcePath, destinationPath);
  await assertRealSelfHostedPrivateFile(destinationPath);
  await applyRootOwnershipIfRoot(destinationPath);
  await chmod(destinationPath, selfHostedPrivateFileMode);
}

export async function ensureSelfHostedPrivateDirectory(directoryPath: string): Promise<void> {
  await assertNoExistingSelfHostedDirectorySymlinks({
    directoryPath,
    label: 'Compartment private directory',
    managedRoots: rootOwnedSelfHostedPathPrefixes,
  });
  await mkdir(directoryPath, { mode: selfHostedPrivateDirectoryMode, recursive: true });
  await assertRealSelfHostedDirectory(directoryPath, 'Compartment private directory');
  await applyRootOwnershipIfRoot(directoryPath);
  await chmod(directoryPath, selfHostedPrivateDirectoryMode);
}

async function assertWritableSelfHostedPrivateFileTarget(filePath: string): Promise<void> {
  const stats: Stats | null = await readOptionalPathStats(filePath);
  if (stats === null) {
    return;
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`Compartment private file ${filePath} must be a real file.`);
  }
}

async function assertRealSelfHostedPrivateFile(filePath: string): Promise<void> {
  const stats: Stats = await lstat(filePath);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`Compartment private file ${filePath} must be a real file.`);
  }
}

async function readOptionalPathStats(path: string): Promise<Stats | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if (error instanceof Error && isMissingFileSystemEntryError(error)) {
      return null;
    }
    throw error;
  }
}

async function applyRootOwnershipIfRoot(path: string): Promise<void> {
  if (process.getuid?.() !== 0 || !isRootOwnedSelfHostedPath(path)) {
    return;
  }

  await chown(path, 0, 0);
}

function isRootOwnedSelfHostedPath(path: string): boolean {
  const resolvedPath: string = resolve(path);
  return rootOwnedSelfHostedPathPrefixes.some((prefix: string): boolean => {
    return resolvedPath === prefix || resolvedPath.startsWith(`${prefix}/`);
  });
}
