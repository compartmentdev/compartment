import type { Stats } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { readOptionalSelfHostedPathStats } from './self-hosted-path-stats';

interface AssertNoExistingSelfHostedDirectorySymlinksInput {
  checkUnmanagedAncestors?: boolean | undefined;
  directoryPath: string;
  label: string;
  managedRoots: readonly string[];
}

export async function assertNoExistingSelfHostedDirectorySymlinks({
  checkUnmanagedAncestors,
  directoryPath,
  label,
  managedRoots,
}: AssertNoExistingSelfHostedDirectorySymlinksInput): Promise<void> {
  for (const checkedPath of readSelfHostedDirectoryCheckPaths(directoryPath, managedRoots, checkUnmanagedAncestors)) {
    const stats: Stats | null = await readOptionalSelfHostedPathStats(checkedPath);
    if (stats === null) {
      continue;
    }
    if (stats.isSymbolicLink()) {
      throw new Error(`${label} ${checkedPath} must be a real directory.`);
    }
  }
}

export async function assertRealSelfHostedDirectory(directoryPath: string, label: string): Promise<void> {
  const stats: Stats = await lstat(directoryPath);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`${label} ${directoryPath} must be a real directory.`);
  }
}

function readSelfHostedDirectoryCheckPaths(
  directoryPath: string,
  managedRoots: readonly string[],
  checkUnmanagedAncestors: boolean = false,
): string[] {
  const resolvedDirectoryPath: string = resolve(directoryPath);
  const rootPath: string | undefined = managedRoots.find(
    (candidateRootPath: string): boolean =>
      resolvedDirectoryPath === candidateRootPath || resolvedDirectoryPath.startsWith(`${candidateRootPath}/`),
  );
  if (rootPath === undefined) {
    return checkUnmanagedAncestors ? readAbsoluteAncestorPaths(resolvedDirectoryPath) : [resolvedDirectoryPath];
  }

  const relativePath: string = resolvedDirectoryPath.slice(rootPath.length);
  const relativeParts: string[] = relativePath.split('/').filter((part: string): boolean => part.length > 0);
  const checkedPaths: string[] = [rootPath];
  for (const relativePart of relativeParts) {
    checkedPaths.push(resolve(checkedPaths[checkedPaths.length - 1]!, relativePart));
  }

  return checkedPaths;
}

function readAbsoluteAncestorPaths(path: string): string[] {
  const paths: string[] = [];
  let currentPath: string = resolve(path);
  for (;;) {
    paths.unshift(currentPath);
    const parentPath: string = dirname(currentPath);
    if (parentPath === currentPath) {
      return paths;
    }
    currentPath = parentPath;
  }
}
