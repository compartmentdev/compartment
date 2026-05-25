import { constants } from 'node:fs';
import { mkdir, open, readFile, type FileHandle } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import {
  isMissingFileSystemEntryError,
  validateSymlinkFreeFileSystemWriteTarget,
  type ValidatedFileSystemWriteTarget,
} from '@compartment/utils';
import type {
  RepositoryTextFileTargetInput,
  RepositoryTextFileUpdateInput,
  RepositoryTextFileWriteInput,
} from './repository-file.store.types';

export async function assertRepositoryTextFileWritable(input: RepositoryTextFileTargetInput): Promise<void> {
  await validateRepositoryTextFileWriteTarget(input);
}

export async function updateRepositoryTextFile(input: RepositoryTextFileUpdateInput): Promise<boolean> {
  const currentContents: string = (await readRepositoryTextFile(input)) ?? '';
  const nextContents: string | undefined = input.update(currentContents);
  if (nextContents === undefined) {
    return false;
  }

  await writeRepositoryTextFile({
    contents: nextContents,
    filePath: input.filePath,
    label: input.label,
    repositoryRoot: input.repositoryRoot,
  });
  return true;
}

export async function readRepositoryTextFile(input: RepositoryTextFileTargetInput): Promise<string | undefined> {
  const writeTarget: ValidatedFileSystemWriteTarget = await validateRepositoryTextFileWriteTarget(input);
  if (!writeTarget.exists) {
    return undefined;
  }

  try {
    return await readFile(resolve(input.filePath), 'utf8');
  } catch (error) {
    const readError: Error | NodeJS.ErrnoException =
      error instanceof Error ? error : new Error(`Failed to read ${input.label}.`);
    if (isMissingFileSystemEntryError(readError)) {
      return undefined;
    }

    throw readError;
  }
}

export async function writeRepositoryTextFile(input: RepositoryTextFileWriteInput): Promise<void> {
  await prepareRepositoryTextFileWrite(input);
  await writeRepositoryTextFileContents(resolve(input.filePath), input.contents);
}

async function prepareRepositoryTextFileWrite(input: RepositoryTextFileTargetInput): Promise<void> {
  await validateRepositoryTextFileWriteTarget(input);
  await mkdir(dirname(resolve(input.filePath)), { recursive: true });
  await validateRepositoryTextFileWriteTarget(input);
}

async function validateRepositoryTextFileWriteTarget(
  input: RepositoryTextFileTargetInput,
): Promise<ValidatedFileSystemWriteTarget> {
  const repositoryRoot: string = resolve(input.repositoryRoot);
  const filePath: string = resolve(input.filePath);
  return await validateSymlinkFreeFileSystemWriteTarget({
    absolutePath: filePath,
    authoredPath: readRepositoryAuthoredPath(repositoryRoot, filePath),
    boundaryDirectory: repositoryRoot,
    boundaryLabel: 'the Git repository',
    label: input.label,
    relativeToLabel: 'the Git repository root',
  });
}

function readRepositoryAuthoredPath(repositoryRoot: string, filePath: string): string {
  const authoredPath: string = relative(repositoryRoot, filePath).replaceAll('\\', '/');
  return authoredPath === '' ? '.' : authoredPath;
}

async function writeRepositoryTextFileContents(filePath: string, contents: string): Promise<void> {
  let handle: FileHandle | null = null;

  try {
    handle = await open(
      filePath,
      constants.O_CREAT | constants.O_NOFOLLOW | constants.O_TRUNC | constants.O_WRONLY,
      0o666,
    );
    await handle.writeFile(contents, 'utf8');
  } finally {
    await closeRepositoryTextFileHandle(handle);
  }
}

async function closeRepositoryTextFileHandle(handle: FileHandle | null): Promise<void> {
  if (handle === null) {
    return;
  }

  await handle.close();
}
