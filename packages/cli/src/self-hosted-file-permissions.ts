import type { Stats } from 'node:fs';
import { chmod, chown, copyFile, lstat, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  assertNoExistingSelfHostedDirectorySymlinks,
  assertRealSelfHostedDirectory,
} from './self-hosted-host-directories';
import { readOptionalSelfHostedPathStats } from './self-hosted-path-stats';

const selfHostedPrivateDirectoryMode: number = 0o700;
const selfHostedPrivateFileMode: number = 0o600;
const rootOwnedSelfHostedPathPrefixes: readonly string[] = [
  '/etc/compartment',
  '/run/compartment',
  '/var/lib/compartment',
  '/var/run/compartment',
].map((path: string): string => resolve(path));

interface SelfHostedPrivateFileOwner {
  readonly gid: number;
  readonly uid: number;
}

interface SelfHostedPrivateFileOptions {
  readonly directoryMode?: number | undefined;
  readonly fileMode?: number | undefined;
  readonly owner?: SelfHostedPrivateFileOwner;
}

export async function writeSelfHostedPrivateFile(
  filePath: string,
  contents: string,
  options: SelfHostedPrivateFileOptions = {},
): Promise<void> {
  await ensureSelfHostedPrivateDirectory(dirname(filePath), options);
  await assertWritableSelfHostedPrivateFileTarget(filePath);
  await writeFile(filePath, contents, {
    encoding: 'utf8',
    mode: readPrivateFileMode(options),
  });
  await assertRealSelfHostedPrivateFile(filePath);
  await applyOwnershipIfRoot(filePath, options.owner);
  await chmod(filePath, readPrivateFileMode(options));
}

export async function copySelfHostedPrivateFile(
  sourcePath: string,
  destinationPath: string,
  options: SelfHostedPrivateFileOptions = {},
): Promise<void> {
  await ensureSelfHostedPrivateDirectory(dirname(destinationPath), options);
  await assertWritableSelfHostedPrivateFileTarget(destinationPath);
  await copyFile(sourcePath, destinationPath);
  await assertRealSelfHostedPrivateFile(destinationPath);
  await applyOwnershipIfRoot(destinationPath, options.owner);
  await chmod(destinationPath, readPrivateFileMode(options));
}

export async function ensureSelfHostedPrivateDirectory(
  directoryPath: string,
  options: SelfHostedPrivateFileOptions = {},
): Promise<void> {
  await assertNoExistingSelfHostedDirectorySymlinks({
    directoryPath,
    label: 'Compartment private directory',
    managedRoots: rootOwnedSelfHostedPathPrefixes,
  });
  await mkdir(directoryPath, { mode: readPrivateDirectoryMode(options), recursive: true });
  await assertRealSelfHostedDirectory(directoryPath, 'Compartment private directory');
  await applyOwnershipIfRoot(directoryPath, options.owner);
  await chmod(directoryPath, readPrivateDirectoryMode(options));
}

async function assertWritableSelfHostedPrivateFileTarget(filePath: string): Promise<void> {
  const stats: Stats | null = await readOptionalSelfHostedPathStats(filePath);
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

async function applyOwnershipIfRoot(path: string, owner: SelfHostedPrivateFileOwner | undefined): Promise<void> {
  if (process.getuid?.() !== 0) {
    return;
  }
  if (owner === undefined && !isRootOwnedSelfHostedPath(path)) {
    return;
  }

  await chown(path, owner?.uid ?? 0, owner?.gid ?? 0);
}

function isRootOwnedSelfHostedPath(path: string): boolean {
  const resolvedPath: string = resolve(path);
  return rootOwnedSelfHostedPathPrefixes.some((prefix: string): boolean => {
    return resolvedPath === prefix || resolvedPath.startsWith(`${prefix}/`);
  });
}

function readPrivateDirectoryMode(options: SelfHostedPrivateFileOptions): number {
  return options.directoryMode ?? selfHostedPrivateDirectoryMode;
}

function readPrivateFileMode(options: SelfHostedPrivateFileOptions): number {
  return options.fileMode ?? selfHostedPrivateFileMode;
}
