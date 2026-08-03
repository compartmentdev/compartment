import { lstat, rm, rmdir } from 'node:fs/promises';
import type { Stats } from 'node:fs';

export async function removeManagedVmOwnedPaths(paths: readonly string[]): Promise<void> {
  const directoryPaths: string[] = [];
  for (const path of paths) {
    const details: Stats | undefined = await readPathDetails(path);
    if (details?.isDirectory() === true) {
      directoryPaths.push(path);
    } else if (details !== undefined) {
      await rm(path, { force: true });
    }
  }
  directoryPaths.sort(longestPathFirst);
  for (const path of directoryPaths) {
    await rmdir(path).catch((error: Error): void => {
      if (!isMissing(error)) {
        throw error;
      }
    });
  }
}

async function readPathDetails(path: string): Promise<Stats | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    if (error instanceof Error && isMissing(error)) {
      return undefined;
    }
    throw error;
  }
}

function longestPathFirst(left: string, right: string): number {
  return right.length - left.length;
}

function isMissing(error: Error): boolean {
  return 'code' in error && error.code === 'ENOENT';
}
