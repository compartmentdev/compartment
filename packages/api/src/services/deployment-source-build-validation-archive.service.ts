import { execFile, type ExecFileOptions } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  compartmentSourcePackageMetadataArchivePath,
  parseCompartmentSourcePackageMetadata,
} from '@compartment/contracts';
import { createLogicalSourceDigest } from '@compartment/source-archive';
import { readSourceArchive } from './deployment-source-build-validation-archive-reader.service';
import type { ReadSourceArchiveResult } from './deployment-source-build-validation-archive.types';
import { toSourceUploadValidationError } from './source-uploads.service.support';

const executeFileAsync: (
  file: string,
  args: readonly string[],
  options?: ExecFileOptions,
) => Promise<{ stderr: string; stdout: string }> = promisify(execFile);

export async function validateSourceUploadArchive(archivePath: string): Promise<string> {
  const sourceArchive: ReadSourceArchiveResult = await readSourceArchiveOrThrowBusinessError(archivePath);

  validateSourcePackageMetadata(sourceArchive.metadataFileContents);
  return await createAcceptedSourceArchiveDigest(archivePath, sourceArchive);
}

async function createAcceptedSourceArchiveDigest(
  archivePath: string,
  sourceArchive: ReadSourceArchiveResult,
): Promise<string> {
  const extractionDirectory: string = await mkdtemp(join(tmpdir(), 'compartment-source-digest-'));
  try {
    await executeFileAsync('tar', ['-xzf', archivePath, '-C', extractionDirectory]);
    return await createLogicalSourceDigest(
      extractionDirectory,
      sourceArchive.logicalEntryPaths.filter(
        (entryPath: string): boolean => entryPath !== compartmentSourcePackageMetadataArchivePath,
      ),
      compartmentSourcePackageMetadataArchivePath,
      sourceArchive.metadataFileContents,
    );
  } finally {
    await rm(extractionDirectory, { force: true, recursive: true });
  }
}

async function readSourceArchiveOrThrowBusinessError(archivePath: string): Promise<ReadSourceArchiveResult> {
  try {
    return await readSourceArchive(archivePath);
  } catch (error) {
    throw toSourceUploadValidationError(error instanceof Error ? error : undefined);
  }
}

function validateSourcePackageMetadata(metadataFileContents: string): void {
  try {
    parseCompartmentSourcePackageMetadata(metadataFileContents);
  } catch (error) {
    throw toSourceUploadValidationError(error instanceof Error ? error : undefined);
  }
}
