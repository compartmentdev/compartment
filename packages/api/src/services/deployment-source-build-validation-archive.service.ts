import { parseCompartmentSourcePackageMetadata } from '@compartment/contracts';
import { readSourceArchive } from './deployment-source-build-validation-archive-reader.service';
import type { ReadSourceArchiveResult } from './deployment-source-build-validation-archive.types';
import { toSourceUploadValidationError } from './source-uploads.service.support';

export async function validateSourceUploadArchive(archivePath: string): Promise<void> {
  const sourceArchive: ReadSourceArchiveResult = await readSourceArchiveOrThrowBusinessError(archivePath);

  validateSourcePackageMetadata(sourceArchive.metadataFileContents);
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
