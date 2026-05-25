import { access } from 'node:fs/promises';
import { dirname } from 'node:path';

export function listDirectoryLineageWithinBoundary(startDirectory: string, stopDirectory: string): string[] {
  const lineage: string[] = [];
  for (const directory of listDirectoryLineage(startDirectory)) {
    lineage.push(directory);
    if (directory === stopDirectory) {
      return lineage;
    }
  }

  return lineage;
}

export function listDirectoryLineage(startDirectory: string): string[] {
  const lineage: string[] = [];
  let currentDirectory: string = startDirectory;
  for (;;) {
    lineage.push(currentDirectory);
    const parentDirectory: string = dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      return lineage;
    }
    currentDirectory = parentDirectory;
  }
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
