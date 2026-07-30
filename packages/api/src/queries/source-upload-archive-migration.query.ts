import { eq, isNull } from 'drizzle-orm';
import { sourceUploads } from '../db/schema';
import type { Database } from '../db/client';

export type SourceUploadArchiveMigrationExecutor = Database;

interface SourceUploadArchiveMigrationRow {
  id: string;
}

export async function listSourceUploadsWithoutArchive(
  db: SourceUploadArchiveMigrationExecutor,
): Promise<SourceUploadArchiveMigrationRow[]> {
  return await db.select({ id: sourceUploads.id }).from(sourceUploads).where(isNull(sourceUploads.archiveBase64));
}

export async function persistMigratedSourceUploadArchive(
  db: SourceUploadArchiveMigrationExecutor,
  sourceUploadId: string,
  archiveBase64: string,
): Promise<void> {
  await db.update(sourceUploads).set({ archiveBase64 }).where(eq(sourceUploads.id, sourceUploadId));
}
