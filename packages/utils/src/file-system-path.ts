import { isAbsolute, relative, sep } from 'node:path';

export function isPathWithinDirectory(directory: string, targetPath: string): boolean {
  const relativePath: string = relative(directory, targetPath);

  return (
    relativePath === '' || (!relativePath.startsWith(`..${sep}`) && relativePath !== '..' && !isAbsolute(relativePath))
  );
}

export function readRequiredAbsolutePath(value: string, variableName: string): string {
  if (isAbsolute(value)) {
    return value;
  }

  throw new Error(`${variableName} must be an absolute path.`);
}

export function isMissingFileSystemEntryError(error: Error): error is NodeJS.ErrnoException {
  return 'code' in error && error.code === 'ENOENT';
}
