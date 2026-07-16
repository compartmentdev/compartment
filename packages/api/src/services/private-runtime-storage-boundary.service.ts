import { constants } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import {
  isMissingFileSystemEntryError,
  validateSymlinkFreeFileSystemEntry,
  validateSymlinkFreeFileSystemWriteTarget,
  type FileSystemEntryKind,
  type ValidatedFileSystemWriteTarget,
} from '@compartment/utils';

interface PrivateRuntimeStoragePathInput {
  label: string;
  path: string;
  storageRoot: string;
}

const noFollowReadFlags: number = constants.O_RDONLY | constants.O_NOFOLLOW;

class PrivateRuntimeStorageEntryNotFoundError extends Error {
  constructor(label: string) {
    super(readPrivateRuntimeStorageEntryMissingMessage(label));
    this.name = 'PrivateRuntimeStorageEntryNotFoundError';
  }
}

export function isPrivateRuntimeStorageEntryNotFoundError(
  error: Error,
): error is PrivateRuntimeStorageEntryNotFoundError {
  return error instanceof PrivateRuntimeStorageEntryNotFoundError;
}

export async function readPrivateRuntimeStorageFile(input: PrivateRuntimeStoragePathInput): Promise<Buffer> {
  await validatePrivateRuntimeStorageEntry(input, 'file');

  const file: FileHandle = await openPrivateRuntimeStorageFile(input);
  try {
    await assertPrivateRuntimeStorageFileHandle(input, file);
    await validatePrivateRuntimeStorageEntry(input, 'file');

    return await file.readFile();
  } finally {
    await file.close();
  }
}

async function openPrivateRuntimeStorageFile(input: PrivateRuntimeStoragePathInput): Promise<FileHandle> {
  try {
    return await open(input.path, noFollowReadFlags);
  } catch (error) {
    if (error instanceof Error && isMissingFileSystemEntryError(error)) {
      throw new PrivateRuntimeStorageEntryNotFoundError(input.label);
    }

    throw error;
  }
}

async function assertPrivateRuntimeStorageFileHandle(
  input: PrivateRuntimeStoragePathInput,
  file: FileHandle,
): Promise<void> {
  if ((await file.stat()).isFile()) {
    return;
  }

  throw new Error(`${input.label} must be a file.`);
}

export async function assertPrivateRuntimeStoragePath(input: PrivateRuntimeStoragePathInput): Promise<void> {
  await validatePrivateRuntimeStorageWriteTarget(input, 'file');
}

async function validatePrivateRuntimeStorageEntry(
  input: PrivateRuntimeStoragePathInput,
  expectedKind: FileSystemEntryKind,
): Promise<void> {
  await validatePrivateRuntimeStorageRoot(input);
  const missingMessage: string = readPrivateRuntimeStorageEntryMissingMessage(input.label);
  try {
    await validateSymlinkFreeFileSystemEntry({
      absolutePath: input.path,
      authoredPath: readPrivateRuntimeStorageAuthoredPath(input),
      boundaryDirectory: input.storageRoot,
      boundaryLabel: 'private runtime storage',
      expectedKind,
      label: input.label,
      missingMessage,
      relativeToLabel: 'private runtime storage root',
    });
  } catch (error) {
    if (error instanceof Error && error.message === missingMessage) {
      throw new PrivateRuntimeStorageEntryNotFoundError(input.label);
    }

    throw error;
  }
}

async function validatePrivateRuntimeStorageWriteTarget(
  input: PrivateRuntimeStoragePathInput,
  expectedKind: FileSystemEntryKind,
): Promise<ValidatedFileSystemWriteTarget> {
  await validatePrivateRuntimeStorageRoot(input);
  return await validateSymlinkFreeFileSystemWriteTarget({
    absolutePath: input.path,
    authoredPath: readPrivateRuntimeStorageAuthoredPath(input),
    boundaryDirectory: input.storageRoot,
    boundaryLabel: 'private runtime storage',
    expectedKind,
    label: input.label,
    relativeToLabel: 'private runtime storage root',
  });
}

async function validatePrivateRuntimeStorageRoot(input: PrivateRuntimeStoragePathInput): Promise<void> {
  await validateSymlinkFreeFileSystemEntry({
    absolutePath: input.storageRoot,
    authoredPath: '.',
    boundaryDirectory: input.storageRoot,
    boundaryLabel: 'private runtime storage',
    expectedKind: 'directory',
    label: `${input.label} storage root`,
    relativeToLabel: 'private runtime storage root',
  });
}

function readPrivateRuntimeStorageAuthoredPath(input: PrivateRuntimeStoragePathInput): string {
  const authoredPath: string = relative(resolve(input.storageRoot), resolve(input.path));
  if (authoredPath !== '') {
    return authoredPath;
  }

  throw new Error(`${input.label} must stay within private runtime storage.`);
}

function readPrivateRuntimeStorageEntryMissingMessage(label: string): string {
  return `${label} does not exist.`;
}
