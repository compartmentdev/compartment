import { realpath, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { isMissingFileSystemEntryError } from '@compartment/utils';

const vcsMetadataDirectoryNames: ReadonlySet<string> = new Set<string>(['.git', '.hg', '.svn']);

export async function findRepositoryBoundary(startDirectory: string): Promise<string | null> {
  let currentDirectory: string = startDirectory;

  for (;;) {
    try {
      await stat(join(currentDirectory, '.git'));
      return currentDirectory;
    } catch (error) {
      if (!(error instanceof Error) || !isMissingFileSystemEntryError(error)) {
        throw error;
      }
    }

    const parentDirectory: string = dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      return null;
    }

    currentDirectory = parentDirectory;
  }
}

export async function readBoundaryRealPath(boundaryDirectory: string): Promise<string> {
  return await realpath(boundaryDirectory);
}

export function findCommonAncestorPath(leftPath: string, rightPath: string): string {
  const leftSegments: string[] = readPathSegments(leftPath);
  const rightSegments: string[] = readPathSegments(rightPath);
  const sharedSegments: string[] = [];
  appendSharedAncestorSegments(leftSegments, rightSegments, sharedSegments);
  return joinSharedAncestorPath(sharedSegments);
}

export function hasVcsMetadataPathSegment(path: string): boolean {
  return readVcsMetadataPathSegments(path).some((segment: string): boolean => vcsMetadataDirectoryNames.has(segment));
}

function readPathSegments(path: string): string[] {
  return resolve(path).split(sep);
}

function readVcsMetadataPathSegments(path: string): string[] {
  return path.split(/[\\/]+/u);
}

function appendSharedAncestorSegments(
  leftSegments: readonly string[],
  rightSegments: readonly string[],
  sharedSegments: string[],
): void {
  const segmentCount: number = Math.min(leftSegments.length, rightSegments.length);

  for (let index: number = 0; index < segmentCount; index += 1) {
    const leftSegment: string | undefined = leftSegments[index];
    if (leftSegment === undefined || leftSegment !== rightSegments[index]) {
      return;
    }

    sharedSegments.push(leftSegment);
  }
}

function joinSharedAncestorPath(sharedSegments: readonly string[]): string {
  if (sharedSegments.length === 0) {
    return sep;
  }

  const joinedPath: string = sharedSegments.join(sep);
  return joinedPath === '' ? sep : joinedPath;
}
