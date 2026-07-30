import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isMissingFileSystemEntryError } from '@compartment/utils';
import {
  listSourceUploadsWithoutArchive,
  persistMigratedSourceUploadArchive,
  type SourceUploadArchiveMigrationExecutor,
} from '../queries/source-upload-archive-migration.query';

const sourceArchiveDirectoryVariableName: string = 'COMPARTMENT_SOURCE_ARCHIVE_DIR';

export async function migrateSourceUploadArchives(
  db: SourceUploadArchiveMigrationExecutor,
  env: NodeJS.ProcessEnv,
): Promise<number> {
  const sourceArchiveDirectory: string | undefined = env[sourceArchiveDirectoryVariableName];
  if (sourceArchiveDirectory === undefined || sourceArchiveDirectory === '') {
    return 0;
  }

  let migratedCount: number = 0;
  for (const row of await listSourceUploadsWithoutArchive(db)) {
    const archive: Buffer | null = await readLegacySourceUploadArchive(sourceArchiveDirectory, row.id);
    if (archive === null) {
      continue;
    }
    await persistMigratedSourceUploadArchive(db, row.id, archive.toString('base64'));
    migratedCount += 1;
  }
  return migratedCount;
}

async function readLegacySourceUploadArchive(directory: string, sourceUploadId: string): Promise<Buffer | null> {
  try {
    return await readFile(join(directory, `${sourceUploadId}.tgz`));
  } catch (error) {
    if (error instanceof Error && isMissingFileSystemEntryError(error)) {
      return null;
    }
    throw error;
  }
}
