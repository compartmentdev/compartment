import { and, eq, isNotNull, isNull, lt, or, type SQL } from 'drizzle-orm';
import { buildArtifacts, deployments, sourceUploads } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type {
  CreateSourceUploadInput,
  PersistedSourceUploadRow,
  SourceUploadLookupInput,
  SourceUploadRow,
} from './source-uploads.query.types';

const expiredSourceUploadCleanupLimit: number = 20;
const expiredSourceUploadCleanupGraceMs: number = 15 * 60 * 1000;

export async function createSourceUpload(input: CreateSourceUploadInput): Promise<SourceUploadRow> {
  const [row] = await getApiDatabase().insert(sourceUploads).values(input).returning();

  return toSourceUploadRow(requirePersistedSourceUploadRow(row, 'create'));
}

export async function findSourceUploadByIdForOrganization(
  input: SourceUploadLookupInput,
): Promise<SourceUploadRow | undefined> {
  const [row] = await getApiDatabase()
    .select()
    .from(sourceUploads)
    .where(and(eq(sourceUploads.id, input.sourceUploadId), eq(sourceUploads.organizationId, input.organizationId)))
    .limit(1);

  return row === undefined ? undefined : toSourceUploadRow(row);
}

export async function listExpiredUnusedSourceUploads(now: Date): Promise<SourceUploadRow[]> {
  const cleanupCutoff: Date = new Date(now.getTime() - expiredSourceUploadCleanupGraceMs);
  const rows: PersistedSourceUploadRow[] = await getApiDatabase()
    .select()
    .from(sourceUploads)
    .where(and(isNull(sourceUploads.consumedAt), lt(sourceUploads.expiresAt, cleanupCutoff)))
    .limit(expiredSourceUploadCleanupLimit);

  return rows.map(toSourceUploadRow);
}

export async function deleteSourceUploadById(sourceUploadId: string): Promise<void> {
  await getApiDatabase().delete(sourceUploads).where(eq(sourceUploads.id, sourceUploadId));
}

export async function hasRetainedSourceUploadReferences(sourceUploadId: string): Promise<boolean> {
  const rows: { id: string }[] = await getApiDatabase()
    .select({ id: deployments.id })
    .from(deployments)
    .innerJoin(buildArtifacts, eq(deployments.buildArtifactId, buildArtifacts.id))
    .where(and(eq(buildArtifacts.sourceUploadId, sourceUploadId), requireRetainedSourceUploadReferenceFilter()))
    .limit(1);

  return rows[0] !== undefined;
}

function requireRetainedSourceUploadReferenceFilter(): SQL {
  const filter: SQL | undefined = or(
    eq(deployments.status, 'queued'),
    eq(deployments.status, 'running'),
    and(
      or(eq(deployments.status, 'succeeded'), eq(deployments.status, 'stopped')),
      eq(buildArtifacts.imageRetentionState, 'available'),
      isNotNull(buildArtifacts.imageRef),
    ),
  );
  if (filter === undefined) {
    throw new Error('Expected retained source upload reference filter.');
  }

  return filter;
}

function toSourceUploadRow(row: PersistedSourceUploadRow): SourceUploadRow {
  return row;
}

function requirePersistedSourceUploadRow(
  row: PersistedSourceUploadRow | undefined,
  action: string,
): PersistedSourceUploadRow {
  if (row === undefined) {
    throw new Error(`Failed to ${action} source upload.`);
  }

  return row;
}
