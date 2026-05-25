import type { Stats } from 'node:fs';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { isMissingFileSystemEntryError, isPathWithinDirectory } from './file-system-path';
import type {
  FileSystemEntryKind,
  ValidateFileSystemEntryInput,
  ValidateFileSystemWriteTargetInput,
  ValidatedFileSystemEntry,
  ValidatedFileSystemWriteTarget,
} from './file-system-boundary.types';

export type {
  FileSystemEntryKind,
  ValidatedFileSystemEntry,
  ValidatedFileSystemWriteTarget,
} from './file-system-boundary.types';

const windowsDriveAbsolutePathPattern: RegExp = /^[A-Za-z]:[/\\]/u;

export async function validateSymlinkFreeFileSystemDirectory(
  input: Omit<ValidateFileSystemEntryInput, 'expectedKind'>,
): Promise<ValidatedFileSystemEntry> {
  const validatedDirectory: ValidatedFileSystemEntry = await validateSymlinkFreeFileSystemEntry({
    ...input,
    expectedKind: 'directory',
  });

  await assertDirectoryTreeContainsNoSymlinks(input.boundaryDirectory, validatedDirectory.absolutePath, input);

  return validatedDirectory;
}

export async function validateSymlinkFreeFileSystemEntry(
  input: ValidateFileSystemEntryInput,
): Promise<ValidatedFileSystemEntry> {
  assertRelativeAuthoredPath(input);
  assertAbsolutePathWithinBoundary(input);
  const targetStats: Stats = await readValidatedTargetStats(input);
  const targetRealPath: string = await realpath(input.absolutePath);
  const boundaryRealPath: string = await realpath(input.boundaryDirectory);
  if (!isPathWithinDirectory(boundaryRealPath, targetRealPath)) {
    throw new Error(`${input.label} "${input.authoredPath}" must stay within ${input.boundaryLabel}.`);
  }
  assertTargetKind(input, targetStats);

  return {
    absolutePath: input.absolutePath,
    realPath: targetRealPath,
  };
}

export async function validateSymlinkFreeFileSystemWriteTarget(
  input: ValidateFileSystemWriteTargetInput,
): Promise<ValidatedFileSystemWriteTarget> {
  assertRelativeAuthoredPath(input);
  assertAbsolutePathWithinBoundary(input);
  const boundaryRealPath: string = await realpath(input.boundaryDirectory);
  const targetExists: boolean = await validateWriteTargetPath(input, boundaryRealPath);

  return {
    absolutePath: input.absolutePath,
    boundaryRealPath,
    exists: targetExists,
  };
}

function assertRelativeAuthoredPath(input: ValidateFileSystemEntryInput | ValidateFileSystemWriteTargetInput): void {
  if (input.relativeToLabel === undefined || !isAbsoluteAuthoredPath(input.authoredPath)) {
    return;
  }

  throw new Error(`${input.label} "${input.authoredPath}" must be relative to ${input.relativeToLabel}.`);
}

function assertAbsolutePathWithinBoundary(
  input: ValidateFileSystemEntryInput | ValidateFileSystemWriteTargetInput,
): void {
  if (isPathWithinDirectory(input.boundaryDirectory, input.absolutePath)) {
    return;
  }

  throw new Error(`${input.label} "${input.authoredPath}" must stay within ${input.boundaryLabel}.`);
}

function isAbsoluteAuthoredPath(path: string): boolean {
  return path.startsWith('/') || path.startsWith('\\') || windowsDriveAbsolutePathPattern.test(path);
}

async function validateWriteTargetPath(
  input: ValidateFileSystemWriteTargetInput,
  boundaryRealPath: string,
): Promise<boolean> {
  const pathSegments: string[] = readPathSegments(relative(input.boundaryDirectory, input.absolutePath));
  return pathSegments.length === 0
    ? await validateWriteTargetSegment(input, boundaryRealPath, input.boundaryDirectory, true)
    : await validateWriteTargetSegments(input, boundaryRealPath, pathSegments);
}

async function validateWriteTargetSegments(
  input: ValidateFileSystemWriteTargetInput,
  boundaryRealPath: string,
  pathSegments: readonly string[],
): Promise<boolean> {
  let currentPath: string = input.boundaryDirectory;
  for (let index: number = 0; index < pathSegments.length; index += 1) {
    currentPath = join(currentPath, pathSegments[index]!);
    const segmentExists: boolean = await validateWriteTargetSegment(
      input,
      boundaryRealPath,
      currentPath,
      index === pathSegments.length - 1,
    );
    if (!segmentExists) {
      return false;
    }
    if (index === pathSegments.length - 1) {
      return true;
    }
  }

  return false;
}

async function validateWriteTargetSegment(
  input: ValidateFileSystemWriteTargetInput,
  boundaryRealPath: string,
  entryPath: string,
  isFinalSegment: boolean,
): Promise<boolean> {
  const currentStats: Stats | undefined = await readOptionalEntryStats(entryPath, input);
  if (currentStats === undefined) {
    return false;
  }
  if (!isFinalSegment) {
    assertWritableParentEntry(input, currentStats);
    return true;
  }

  assertWritableTarget(input, currentStats);
  await assertExistingWriteTargetWithinRealBoundary(input, boundaryRealPath);
  return true;
}

async function readValidatedTargetStats(input: ValidateFileSystemEntryInput): Promise<Stats> {
  const pathSegments: string[] = readPathSegments(relative(input.boundaryDirectory, input.absolutePath));
  let currentPath: string = input.boundaryDirectory;
  let currentStats: Stats | null = null;

  if (pathSegments.length === 0) {
    currentStats = await readEntryStats(currentPath, input);
  }

  for (const pathSegment of pathSegments) {
    currentPath = join(currentPath, pathSegment);
    currentStats = await readEntryStats(currentPath, input);
  }

  if (currentStats === null) {
    throw new Error(`${input.label} "${input.authoredPath}" does not exist.`);
  }

  return currentStats;
}

async function readOptionalEntryStats(
  entryPath: string,
  input: ValidateFileSystemWriteTargetInput,
): Promise<Stats | undefined> {
  return await readExistingEntryStats(entryPath, input);
}

async function readEntryStats(entryPath: string, input: ValidateFileSystemEntryInput): Promise<Stats> {
  const entryStats: Stats | undefined = await readExistingEntryStats(entryPath, input);
  if (entryStats === undefined) {
    throw new Error(input.missingMessage ?? `${input.label} "${input.authoredPath}" does not exist.`);
  }

  return entryStats;
}

async function readExistingEntryStats(
  entryPath: string,
  input: ValidateFileSystemEntryInput | ValidateFileSystemWriteTargetInput,
): Promise<Stats | undefined> {
  try {
    const entryStats: Stats = await lstat(entryPath);
    if (entryStats.isSymbolicLink()) {
      throw new Error(`${input.label} "${input.authoredPath}" must not include symlinks.`);
    }

    return entryStats;
  } catch (error) {
    if (error instanceof Error && isMissingFileSystemEntryError(error)) {
      return undefined;
    }

    throw error;
  }
}

function assertWritableTarget(input: ValidateFileSystemWriteTargetInput, targetStats: Stats): void {
  const expectedKind: FileSystemEntryKind = input.expectedKind ?? 'file';
  if (expectedKind === 'any') {
    return;
  }
  if (expectedKind === 'directory' && targetStats.isDirectory()) {
    return;
  }
  if (expectedKind === 'file' && targetStats.isFile()) {
    return;
  }

  throw new Error(
    `${input.label} "${input.authoredPath}" must point to a ${expectedKind === 'directory' ? 'directory' : 'file'}.`,
  );
}

function assertWritableParentEntry(input: ValidateFileSystemWriteTargetInput, parentStats: Stats): void {
  if (parentStats.isDirectory()) {
    return;
  }

  throw new Error(`${input.label} "${input.authoredPath}" must not include non-directory parent entries.`);
}

async function assertExistingWriteTargetWithinRealBoundary(
  input: ValidateFileSystemWriteTargetInput,
  boundaryRealPath: string,
): Promise<void> {
  const targetRealPath: string = await realpath(input.absolutePath);
  if (isPathWithinDirectory(boundaryRealPath, targetRealPath)) {
    return;
  }

  throw new Error(`${input.label} "${input.authoredPath}" must stay within ${input.boundaryLabel}.`);
}

function assertTargetKind(input: ValidateFileSystemEntryInput, targetStats: Stats): void {
  if (input.expectedKind === 'any') {
    return;
  }
  if (input.expectedKind === 'directory' && targetStats.isDirectory()) {
    return;
  }
  if (input.expectedKind === 'file' && targetStats.isFile()) {
    return;
  }

  throw new Error(
    `${input.label} "${input.authoredPath}" must point to a ${input.expectedKind === 'directory' ? 'directory' : 'file'}.`,
  );
}

async function assertDirectoryTreeContainsNoSymlinks(
  boundaryDirectory: string,
  directoryPath: string,
  input: Omit<ValidateFileSystemEntryInput, 'expectedKind'>,
): Promise<void> {
  const children: string[] = (await readdir(directoryPath)).sort((left: string, right: string): number =>
    left.localeCompare(right),
  );

  for (const child of children) {
    const childPath: string = join(directoryPath, child);
    const childStats: Stats = await lstat(childPath);
    if (childStats.isSymbolicLink()) {
      throw new Error(
        `${input.label} "${input.authoredPath}" must not include symlink entry "${relative(boundaryDirectory, childPath)}".`,
      );
    }
    if (childStats.isDirectory()) {
      await assertDirectoryTreeContainsNoSymlinks(boundaryDirectory, childPath, input);
    }
  }
}

function readPathSegments(relativePath: string): string[] {
  if (relativePath === '') {
    return [];
  }

  return relativePath.split(/[\\/]+/u).filter((segment: string): boolean => segment !== '');
}
