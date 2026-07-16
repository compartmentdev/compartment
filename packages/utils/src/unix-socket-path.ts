import { chmodSync, chownSync, lstatSync, mkdirSync, unlinkSync, type Stats } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, resolve } from 'node:path';
import { isMissingFileSystemEntryError } from './file-system-path';

export interface UnixSocketPathPolicy {
  readonly directoryLabel: string;
  readonly directoryMode: number;
  readonly owner?: UnixSocketPathOwner;
  readonly privatePathExample: string;
  readonly socketMode: number;
  readonly variableName: string;
}

export interface UnixSocketPathOwner {
  readonly gid: number;
  readonly uid: number;
}

const fixedTmpRootPath: string = resolve('/', 'tmp');
const fixedVarRunRootPath: string = resolve('/', 'var', 'run');
const fixedVarTmpRootPath: string = resolve('/', 'var', 'tmp');
const runtimeTmpRootPath: string = resolve(tmpdir());
const symlinkPermittedRootPaths: ReadonlySet<string> = new Set<string>(
  ['/run', fixedVarRunRootPath, fixedTmpRootPath, fixedVarTmpRootPath, runtimeTmpRootPath].map((path: string): string =>
    resolve(path),
  ),
);
const sharedUnixSocketRootPaths: ReadonlySet<string> = new Set<string>(
  [
    '/run',
    '/run/compartment',
    fixedTmpRootPath,
    resolve(fixedTmpRootPath, 'compartment'),
    fixedVarRunRootPath,
    '/var/run/compartment',
    fixedVarTmpRootPath,
    runtimeTmpRootPath,
    resolve(runtimeTmpRootPath, 'compartment'),
  ].map((path: string): string => resolve(path)),
);

export function prepareUnixSocketPath(socketPath: string, policy: UnixSocketPathPolicy): void {
  assertValidUnixSocketPath(socketPath, policy);
  const socketDirectory: string = dirname(socketPath);
  assertNoExistingUnixSocketDirectorySymlinks(socketDirectory, policy);
  mkdirSync(socketDirectory, { mode: policy.directoryMode, recursive: true });
  assertRealUnixSocketDirectory(socketDirectory, policy);
  applyRootOwnershipIfRoot(socketDirectory, policy);
  chmodSync(socketDirectory, policy.directoryMode);
  unlinkExistingUnixSocket(socketPath);
}

export function restrictUnixSocketPathPermissions(socketPath: string, policy: UnixSocketPathPolicy): void {
  applyRootOwnershipIfRoot(socketPath, policy);
  chmodSync(socketPath, policy.socketMode);
}

export function assertValidUnixSocketPath(socketPath: string, policy: UnixSocketPathPolicy): void {
  if (!isAbsolute(socketPath)) {
    throw new Error(`${policy.variableName} must be an absolute socket path.`);
  }

  const socketDirectory: string = resolve(dirname(socketPath));
  if (sharedUnixSocketRootPaths.has(socketDirectory)) {
    throw new Error(
      `${policy.variableName} must point to a socket inside a private subdirectory like ${policy.privatePathExample}.`,
    );
  }
}

function assertRealUnixSocketDirectory(socketDirectory: string, policy: UnixSocketPathPolicy): void {
  const socketDirectoryStats: Stats = lstatSync(socketDirectory);
  if (socketDirectoryStats.isSymbolicLink() || !socketDirectoryStats.isDirectory()) {
    throw new Error(`${policy.directoryLabel} ${socketDirectory} must be a real directory.`);
  }
}

function assertNoExistingUnixSocketDirectorySymlinks(socketDirectory: string, policy: UnixSocketPathPolicy): void {
  for (const directoryPath of readSocketDirectorySymlinkCheckPaths(socketDirectory)) {
    if (isMissingPath(directoryPath)) {
      continue;
    }
    if (lstatSync(directoryPath).isSymbolicLink()) {
      throw new Error(`${policy.directoryLabel} ${directoryPath} must be a real directory.`);
    }
  }
}

function readSocketDirectorySymlinkCheckPaths(socketDirectory: string): string[] {
  const directoryPaths: string[] = readAbsoluteAncestorPaths(resolve(socketDirectory));
  const rootIndex: number = readSocketRootIndex(directoryPaths);
  if (rootIndex < 0) {
    return directoryPaths;
  }

  const rootPath: string = directoryPaths[rootIndex]!;
  return directoryPaths.slice(symlinkPermittedRootPaths.has(rootPath) ? rootIndex + 1 : rootIndex);
}

function readAbsoluteAncestorPaths(path: string): string[] {
  const paths: string[] = [];
  let currentPath: string = path;
  for (;;) {
    paths.unshift(currentPath);
    const parentPath: string = dirname(currentPath);
    if (parentPath === currentPath) {
      return paths;
    }
    currentPath = parentPath;
  }
}

function readSocketRootIndex(directoryPaths: readonly string[]): number {
  let rootIndex: number = -1;
  for (const [index, directoryPath] of directoryPaths.entries()) {
    if (sharedUnixSocketRootPaths.has(directoryPath)) {
      rootIndex = index;
    }
  }

  return rootIndex;
}

function unlinkExistingUnixSocket(socketPath: string): void {
  try {
    const socketStats: Stats = lstatSync(socketPath);
    if (socketStats.isSymbolicLink() || !socketStats.isSocket()) {
      throw new Error(`Refusing to replace non-socket path at ${socketPath}.`);
    }
    unlinkSync(socketPath);
  } catch (error) {
    if (error instanceof Error && isMissingFileSystemEntryError(error)) {
      return;
    }
    throw error;
  }
}

function isMissingPath(path: string): boolean {
  try {
    lstatSync(path);
    return false;
  } catch (error) {
    if (error instanceof Error && isMissingFileSystemEntryError(error)) {
      return true;
    }
    throw error;
  }
}

function applyRootOwnershipIfRoot(path: string, policy: UnixSocketPathPolicy): void {
  if (process.getuid?.() !== 0) {
    return;
  }

  chownSync(path, policy.owner?.uid ?? 0, policy.owner?.gid ?? 0);
}
