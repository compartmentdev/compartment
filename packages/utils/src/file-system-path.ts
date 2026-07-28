import { isAbsolute, relative, sep } from 'node:path';

export function isPathWithinDirectory(directory: string, targetPath: string): boolean {
  const relativePath: string = relative(directory, targetPath);

  return (
    relativePath === '' || (!relativePath.startsWith(`..${sep}`) && relativePath !== '..' && !isAbsolute(relativePath))
  );
}

export function isMissingFileSystemEntryError(error: Error): error is NodeJS.ErrnoException {
  return 'code' in error && error.code === 'ENOENT';
}
