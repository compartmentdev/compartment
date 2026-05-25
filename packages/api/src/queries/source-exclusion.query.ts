import { and, asc, eq, inArray } from 'drizzle-orm';
import { sourceExcludedDescriptors } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import { requirePersistedRow } from './persisted-row.query.shared';
import type {
  CreateSourceExcludedDescriptorInput,
  PersistedSourceExcludedDescriptorRow,
  SourceExcludedDescriptorRow,
  SourceReadExecutor,
  SourceWriteExecutor,
} from './source.query.types';

export async function listSourceExcludedDescriptorsBySourceIds(
  sourceIds: readonly string[],
): Promise<SourceExcludedDescriptorRow[]> {
  return await listSourceExcludedDescriptorsBySourceIdsWithExecutor(getApiDatabase(), sourceIds);
}

export async function listSourceExcludedDescriptorsBySourceIdsWithExecutor(
  executor: SourceReadExecutor,
  sourceIds: readonly string[],
): Promise<SourceExcludedDescriptorRow[]> {
  if (sourceIds.length === 0) {
    return [];
  }

  const rows: PersistedSourceExcludedDescriptorRow[] = await executor
    .select()
    .from(sourceExcludedDescriptors)
    .where(inArray(sourceExcludedDescriptors.sourceId, [...sourceIds]))
    .orderBy(asc(sourceExcludedDescriptors.descriptorPath), asc(sourceExcludedDescriptors.id));

  return rows;
}

export async function upsertSourceExcludedDescriptor(
  executor: SourceWriteExecutor,
  input: CreateSourceExcludedDescriptorInput,
): Promise<SourceExcludedDescriptorRow> {
  const [created]: PersistedSourceExcludedDescriptorRow[] = await executor
    .insert(sourceExcludedDescriptors)
    .values(input)
    .onConflictDoUpdate({
      set: {
        updatedAt: input.updatedAt,
      },
      target: [sourceExcludedDescriptors.sourceId, sourceExcludedDescriptors.descriptorPath],
    })
    .returning();

  return requirePersistedRow(created, 'source excluded descriptor');
}

export async function deleteSourceExcludedDescriptorByPath(
  executor: SourceWriteExecutor,
  sourceId: string,
  descriptorPath: string,
): Promise<void> {
  await executor
    .delete(sourceExcludedDescriptors)
    .where(
      and(
        eq(sourceExcludedDescriptors.sourceId, sourceId),
        eq(sourceExcludedDescriptors.descriptorPath, descriptorPath),
      ),
    );
}
