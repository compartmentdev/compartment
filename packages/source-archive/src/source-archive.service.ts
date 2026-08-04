import { execFile, type ExecFileOptions } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import {
  compartmentSourcePackageMetadataArchivePath,
  serializeCompartmentSourcePackageMetadata,
  type CompartmentSourcePackageMetadata,
} from '@compartment/contracts';
import { listIncludedSourceArchiveEntries } from './source-archive-entry-list.service';
import { createLogicalSourceDigest } from './source-logical-digest.service';
import { planSourceArchive } from './source-archive-plan.service';
import type { PlannedSourceArchive } from './source-archive-plan.service.types';
import type { CreatedSourceArchive, SourceArchiveBuilderInput } from './source-archive.service.types';

const executeFileAsync: (
  file: string,
  args: readonly string[],
  options?: ExecFileOptions,
) => Promise<{ stderr: string; stdout: string }> = promisify(execFile);
const gzipAsync: (buffer: Uint8Array) => Promise<Buffer> = promisify(gzip);

export async function createSourceArchive(input: SourceArchiveBuilderInput): Promise<CreatedSourceArchive> {
  const archivePlan: PlannedSourceArchive = await planSourceArchive(input);
  const sourcePackageMetadata: CompartmentSourcePackageMetadata = readSourcePackageMetadata(archivePlan);
  const archiveEntries: string[] = readSourceArchiveTarEntries(await listIncludedSourceArchiveEntries(archivePlan));
  const serializedSourcePackageMetadata: string = serializeCompartmentSourcePackageMetadata(sourcePackageMetadata);

  return {
    archiveRoot: archivePlan.archiveRoot,
    sourceDigest: await createLogicalSourceDigest(
      archivePlan.archiveRoot,
      archiveEntries,
      compartmentSourcePackageMetadataArchivePath,
      serializedSourcePackageMetadata,
    ),
    sourceArchive: await captureTarArchive(archivePlan.archiveRoot, archiveEntries, serializedSourcePackageMetadata),
    sourcePackageMetadata,
  };
}

function readSourcePackageMetadata(archivePlan: PlannedSourceArchive): CompartmentSourcePackageMetadata {
  return {
    descriptorDirectoryRelativePath: archivePlan.descriptorDirectoryRelativePath,
    servicePaths: archivePlan.servicePaths,
    version: 1,
  };
}

function readSourceArchiveTarEntries(archiveEntries: readonly string[]): string[] {
  return archiveEntries.filter((entryPath: string): boolean => !isGeneratedMetadataArchivePath(entryPath));
}

function isGeneratedMetadataArchivePath(entryPath: string): boolean {
  return (
    entryPath === compartmentSourcePackageMetadataArchivePath ||
    entryPath.startsWith(`${compartmentSourcePackageMetadataArchivePath}/`)
  );
}

async function captureTarArchive(
  archiveRoot: string,
  archiveEntries: readonly string[],
  sourcePackageMetadata: string,
): Promise<Buffer> {
  const tempDirectory: string = await mkdtemp(join(tmpdir(), 'compartment-source-archive-'));
  const archiveFileListPath: string = join(tempDirectory, 'archive-file-list.txt');
  const archiveTarPath: string = join(tempDirectory, 'source.tar');
  const sourcePackageDirectory: string = join(tempDirectory, '.compartment');

  try {
    await writeFile(archiveFileListPath, serializeTarFileList(archiveEntries));
    await mkdir(sourcePackageDirectory, { recursive: true });
    await writeFile(join(tempDirectory, compartmentSourcePackageMetadataArchivePath), sourcePackageMetadata);
    await executeTarCreate(archiveRoot, archiveFileListPath, archiveTarPath);
    await executeTarAppendMetadata(tempDirectory, archiveTarPath);
    return await gzipAsync(await readFile(archiveTarPath));
  } finally {
    await rm(tempDirectory, { force: true, recursive: true });
  }
}

function serializeTarFileList(archiveEntries: readonly string[]): Buffer {
  if (archiveEntries.length === 0) {
    return Buffer.alloc(0);
  }

  return Buffer.from(`${archiveEntries.join('\0')}\0`);
}

async function executeTarCreate(
  archiveRoot: string,
  archiveFileListPath: string,
  archiveTarPath: string,
): Promise<void> {
  await executeFileAsync('tar', ['-cf', archiveTarPath, '--no-recursion', '--null', '-T', archiveFileListPath], {
    cwd: archiveRoot,
  });
}

async function executeTarAppendMetadata(tempDirectory: string, archiveTarPath: string): Promise<void> {
  await executeFileAsync('tar', [
    '-rf',
    archiveTarPath,
    '-C',
    tempDirectory,
    compartmentSourcePackageMetadataArchivePath,
  ]);
}
