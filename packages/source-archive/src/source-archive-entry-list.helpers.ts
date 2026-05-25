import { readdir } from 'node:fs/promises';

export function addDirectoryEntry(directoryRelativePath: string, entries: Set<string>): void {
  if (directoryRelativePath !== '.') {
    entries.add(directoryRelativePath);
  }
}

export function assertSelectedSourcePathIsNotSymlink(relativePath: string): void {
  throw new Error(`Selected source path "${relativePath}" must not include symlinks.`);
}

export function joinRelativePath(parentRelativePath: string, name: string): string {
  return parentRelativePath === '.' ? name : `${parentRelativePath}/${name}`;
}

export async function readSortedDirectoryEntries(directoryPath: string): Promise<string[]> {
  const children: string[] = await readdir(directoryPath);
  return children.sort((left: string, right: string): number => left.localeCompare(right));
}
