import { writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  assertRepositoryTextFileWritable,
  readRepositoryTextFile,
  writeRepositoryTextFile,
} from './repository-file.store';

export async function writeCompartmentDescriptorFile(filePath: string, contents: string): Promise<void> {
  try {
    await writeFile(filePath, contents, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    const writeError: Error = error instanceof Error ? error : new Error('Failed to write compartment.yml.');

    throw toCompartmentDescriptorWriteError(writeError);
  }
}

function toCompartmentDescriptorWriteError(error: NodeJS.ErrnoException | Error): Error {
  if (isErrnoException(error) && error.code === 'EEXIST') {
    return new Error('compartment.yml already exists in this directory.');
  }

  return error;
}

function isErrnoException(error: NodeJS.ErrnoException | Error): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

export async function updateCompartmentDescriptorProjectName(
  filePath: string,
  currentProjectName: string,
  nextProjectName: string,
  repositoryRoot?: string,
): Promise<void> {
  const descriptorWriteBoundary: string = readDescriptorWriteBoundary(filePath, repositoryRoot);
  const lines: string[] = await readCompartmentDescriptorLines(filePath, descriptorWriteBoundary);
  const nameLineIndex: number = readCompartmentDescriptorNameLineIndex(lines);

  assertCompartmentDescriptorProjectName(lines[nameLineIndex] ?? '', currentProjectName);

  lines[nameLineIndex] = `name: ${nextProjectName}`;
  await writeRepositoryTextFile({
    contents: lines.join('\n'),
    filePath,
    label: 'compartment.yml',
    repositoryRoot: descriptorWriteBoundary,
  });
}

export async function assertCompartmentDescriptorProjectNameUpdateWritable(
  filePath: string,
  repositoryRoot?: string,
): Promise<void> {
  await assertRepositoryTextFileWritable({
    filePath,
    label: 'compartment.yml',
    repositoryRoot: readDescriptorWriteBoundary(filePath, repositoryRoot),
  });
}

async function readCompartmentDescriptorLines(filePath: string, repositoryRoot: string): Promise<string[]> {
  const fileContents: string | undefined = await readRepositoryTextFile({
    filePath,
    label: 'compartment.yml',
    repositoryRoot,
  });
  if (fileContents === undefined) {
    throw new Error('compartment.yml does not exist.');
  }

  return fileContents.split('\n');
}

function readCompartmentDescriptorNameLineIndex(lines: readonly string[]): number {
  const nameLineIndex: number = lines.findIndex((line: string): boolean => line.startsWith('name:'));
  if (nameLineIndex === -1) {
    throw new Error('compartment.yml must define a project name.');
  }

  return nameLineIndex;
}

function assertCompartmentDescriptorProjectName(currentLine: string, currentProjectName: string): void {
  const storedProjectName: string = currentLine.slice('name:'.length).trim();
  if (storedProjectName !== currentProjectName) {
    throw new Error('compartment.yml changed while renaming the linked project.');
  }
}

function readDescriptorWriteBoundary(filePath: string, repositoryRoot: string | undefined): string {
  return repositoryRoot ?? dirname(filePath);
}
