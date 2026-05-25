import { execFile, type ExecFileOptions } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  compartmentDescriptorFileName,
  compartmentRoutesFileName,
  compartmentSourcePackageMetadataArchivePath,
  joinCompartmentSourcePackageRelativePath,
  parseCompartmentSourcePackageMetadata,
  readCompartmentSourcePackageLiteralArchiveEntryPath,
  validateCompartmentSourcePackageArchiveEntryType,
  type CompartmentSourcePackageMetadata,
} from '@compartment/contracts';
import { isMissingFileSystemEntryError, readNonEmptyLines } from '@compartment/utils';
import { extractTarArchiveWithoutSameOwner } from './worker-archive-extraction.service';
import { hasDirectoryFile } from './worker-source-file-presence.service';

const sourceArchiveListingMaxBufferBytes: number = 16 * 1024 * 1024;
const executeFileAsync: (
  file: string,
  args: readonly string[],
  options?: ExecFileOptions,
) => Promise<{ stderr: string; stdout: string }> = promisify(execFile);

export async function extractValidatedSourceArchive(archivePath: string, extractionDirectory: string): Promise<void> {
  await validateSourceArchiveManifest(archivePath);
  await mkdir(extractionDirectory, { recursive: true });
  await extractTarArchiveWithoutSameOwner(archivePath, extractionDirectory);
}

export async function readSourcePackageMetadata(
  extractionDirectory: string,
  requireRoutesFile: boolean,
): Promise<CompartmentSourcePackageMetadata> {
  const sourcePackageMetadata: CompartmentSourcePackageMetadata | null =
    await readParsedSourcePackageMetadata(extractionDirectory);
  if (sourcePackageMetadata === null) {
    throw new Error('Uploaded source archive is missing source-package metadata.');
  }

  await validateRequiredMetadataDescriptorFiles(
    extractionDirectory,
    sourcePackageMetadata.descriptorDirectoryRelativePath,
    requireRoutesFile,
  );
  return sourcePackageMetadata;
}

async function readParsedSourcePackageMetadata(
  extractionDirectory: string,
): Promise<CompartmentSourcePackageMetadata | null> {
  try {
    return parseCompartmentSourcePackageMetadata(
      await readRequiredFile(join(extractionDirectory, compartmentSourcePackageMetadataArchivePath)),
    );
  } catch (error) {
    if (!(error instanceof Error) || !isMissingFileSystemEntryError(error)) {
      throw error;
    }
  }

  return null;
}

async function validateSourceArchiveManifest(archivePath: string): Promise<void> {
  const archivePaths: string[] = await readSourceArchiveListingLines(archivePath, ['-tzf', archivePath]);
  const archiveTypeLines: string[] = await readSourceArchiveListingLines(archivePath, ['-tvzf', archivePath]);
  if (archivePaths.length !== archiveTypeLines.length) {
    throw new Error('Uploaded source archive contains an invalid manifest.');
  }

  archivePaths.forEach((entryPath: string, index: number): void => {
    readCompartmentSourcePackageLiteralArchiveEntryPath(entryPath);
    validateCompartmentSourcePackageArchiveEntryType(entryPath, archiveTypeLines[index]?.[0] ?? '');
  });
}

async function readSourceArchiveListingLines(archivePath: string, args: readonly string[]): Promise<string[]> {
  const archiveListing: { stdout: string } = await executeFileAsync('tar', args, {
    maxBuffer: sourceArchiveListingMaxBufferBytes,
  });

  return readNonEmptyLines(archiveListing.stdout);
}

async function validateRequiredMetadataDescriptorFiles(
  extractionDirectory: string,
  descriptorDirectoryRelativePath: string,
  requireRoutesFile: boolean,
): Promise<void> {
  await validateRequiredDescriptorFile(
    extractionDirectory,
    joinCompartmentSourcePackageRelativePath(descriptorDirectoryRelativePath, compartmentDescriptorFileName),
    'Uploaded source archive metadata descriptor directory must contain compartment.yml.',
  );
  if (!requireRoutesFile) {
    return;
  }

  await validateRequiredDescriptorFile(
    extractionDirectory,
    joinCompartmentSourcePackageRelativePath(descriptorDirectoryRelativePath, compartmentRoutesFileName),
    'Uploaded source archive metadata descriptor directory must contain compartment.routes.yml.',
  );
}

async function validateRequiredDescriptorFile(
  extractionDirectory: string,
  descriptorPath: string,
  errorMessage: string,
): Promise<void> {
  if (await hasDirectoryFile(extractionDirectory, descriptorPath)) {
    return;
  }

  throw new Error(errorMessage);
}

async function readRequiredFile(filePath: string): Promise<string> {
  return await readFile(filePath, 'utf8');
}
