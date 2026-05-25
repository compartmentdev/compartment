import { and, desc, eq, inArray } from 'drizzle-orm';
import { sourceBindingBranchMappings, sourceBindings } from '../db/schema';
import { requirePersistedRow } from './persisted-row.query.shared';
import type {
  CreateSourceBindingBranchMappingInput,
  CreateSourceBindingInput,
  PersistedSourceBindingRow,
  SourceBindingStatus,
  SourceBindingRow,
  SourceReadExecutor,
  SourceWriteExecutor,
  UpdateSourceBindingToActiveInput,
  UpdateSourceBindingWatchPathsInput,
} from './source.query.types';

export async function findActiveBindingByProjectIdWithExecutor(
  executor: SourceReadExecutor,
  projectId: string,
): Promise<SourceBindingRow | undefined> {
  return await findBindingByProjectIdWithStatus(executor, projectId, 'active');
}

export async function findDisconnectedBindingByProjectIdWithExecutor(
  executor: SourceReadExecutor,
  projectId: string,
): Promise<SourceBindingRow | undefined> {
  return await findBindingByProjectIdWithStatus(executor, projectId, 'disconnected');
}

export async function findActiveBindingByDescriptorPathWithExecutor(
  executor: SourceReadExecutor,
  sourceId: string,
  descriptorPath: string,
): Promise<SourceBindingRow | undefined> {
  return await findBindingByDescriptorPathWithStatus(executor, sourceId, descriptorPath, 'active');
}

export async function findDisconnectedBindingByDescriptorPath(
  executor: SourceReadExecutor,
  sourceId: string,
  descriptorPath: string,
): Promise<SourceBindingRow | undefined> {
  return await findBindingByDescriptorPathWithStatus(executor, sourceId, descriptorPath, 'disconnected', true);
}

export async function findDisconnectedBindingByIdWithExecutor(
  executor: SourceReadExecutor,
  sourceBindingId: string,
): Promise<SourceBindingRow | undefined> {
  return await findBindingByIdWithStatus(executor, sourceBindingId, 'disconnected');
}

async function findBindingByIdWithStatus(
  executor: SourceReadExecutor,
  sourceBindingId: string,
  status: SourceBindingStatus,
): Promise<SourceBindingRow | undefined> {
  const rows: PersistedSourceBindingRow[] = await executor
    .select()
    .from(sourceBindings)
    .where(and(eq(sourceBindings.id, sourceBindingId), eq(sourceBindings.status, status)))
    .limit(1);

  return rows[0];
}

async function findBindingByDescriptorPathWithStatus(
  executor: SourceReadExecutor,
  sourceId: string,
  descriptorPath: string,
  status: SourceBindingStatus,
  preferMostRecent: boolean = false,
): Promise<SourceBindingRow | undefined> {
  const rows: PersistedSourceBindingRow[] = await executor
    .select()
    .from(sourceBindings)
    .where(
      and(
        eq(sourceBindings.sourceId, sourceId),
        eq(sourceBindings.descriptorPath, descriptorPath),
        eq(sourceBindings.status, status),
      ),
    )
    .orderBy(
      ...(preferMostRecent ? [desc(sourceBindings.updatedAt), desc(sourceBindings.createdAt)] : [sourceBindings.id]),
    )
    .limit(1);

  return rows[0];
}

async function findBindingByProjectIdWithStatus(
  executor: SourceReadExecutor,
  projectId: string,
  status: SourceBindingStatus,
): Promise<SourceBindingRow | undefined> {
  const rows: PersistedSourceBindingRow[] = await executor
    .select()
    .from(sourceBindings)
    .where(and(eq(sourceBindings.projectId, projectId), eq(sourceBindings.status, status)))
    .limit(1);

  return rows[0];
}

export async function listActiveAndDisconnectedBindingsBySourceIdsWithExecutor(
  executor: SourceReadExecutor,
  sourceIds: readonly string[],
): Promise<SourceBindingRow[]> {
  const rows: SourceBindingRow[] = await listBindingsBySourceIdsWithStatusesWithExecutor(executor, sourceIds, [
    'active',
    'disconnected',
  ]);
  return rows.sort(compareBindingsByUpdatedAt);
}

export async function createSourceBinding(
  executor: SourceWriteExecutor,
  input: CreateSourceBindingInput,
): Promise<SourceBindingRow> {
  const [binding]: PersistedSourceBindingRow[] = await executor.insert(sourceBindings).values(input).returning();
  return requirePersistedRow(binding, 'source binding');
}

export async function updateSourceBindingToActive(
  executor: SourceWriteExecutor,
  input: UpdateSourceBindingToActiveInput,
): Promise<SourceBindingRow> {
  const [binding]: PersistedSourceBindingRow[] = await executor
    .update(sourceBindings)
    .set({
      autoDeployEnabled: input.autoDeployEnabled,
      disconnectedAt: null,
      descriptorDirectory: input.descriptorDirectory,
      descriptorPath: input.descriptorPath,
      projectId: input.projectId,
      projectName: input.projectName,
      status: 'active',
      updatedAt: input.updatedAt,
      watchPathsJson: input.watchPathsJson,
    })
    .where(eq(sourceBindings.id, input.sourceBindingId))
    .returning();

  return requirePersistedRow(binding, 'source binding');
}

export async function updateSourceBindingWatchPaths(
  executor: SourceWriteExecutor,
  input: UpdateSourceBindingWatchPathsInput,
): Promise<SourceBindingRow> {
  const [binding]: PersistedSourceBindingRow[] = await executor
    .update(sourceBindings)
    .set({
      updatedAt: input.updatedAt,
      watchPathsJson: input.watchPathsJson,
    })
    .where(and(eq(sourceBindings.id, input.sourceBindingId), eq(sourceBindings.status, 'active')))
    .returning();

  return requirePersistedRow(binding, 'source binding');
}

export async function disconnectBindingsBySource(
  executor: SourceWriteExecutor,
  sourceId: string,
  now: Date,
): Promise<void> {
  await executor
    .update(sourceBindings)
    .set({
      disconnectedAt: now,
      status: 'disconnected',
      updatedAt: now,
    })
    .where(and(eq(sourceBindings.sourceId, sourceId), eq(sourceBindings.status, 'active')));
}

export async function disconnectSourceBindingById(
  executor: SourceWriteExecutor,
  sourceBindingId: string,
  now: Date,
): Promise<SourceBindingRow> {
  const [binding]: PersistedSourceBindingRow[] = await executor
    .update(sourceBindings)
    .set({
      disconnectedAt: now,
      status: 'disconnected',
      updatedAt: now,
    })
    .where(and(eq(sourceBindings.id, sourceBindingId), eq(sourceBindings.status, 'active')))
    .returning();

  return requirePersistedRow(binding, 'source binding');
}

export async function clearDisconnectedBindingProjectReferences(
  executor: SourceWriteExecutor,
  projectId: string,
  now: Date,
): Promise<void> {
  await executor
    .update(sourceBindings)
    .set({
      projectId: null,
      updatedAt: now,
    })
    .where(and(eq(sourceBindings.projectId, projectId), eq(sourceBindings.status, 'disconnected')));
}

export async function replaceBranchMappingsForBinding(
  executor: SourceWriteExecutor,
  sourceBindingId: string,
  input: CreateSourceBindingBranchMappingInput,
): Promise<void> {
  await executor
    .delete(sourceBindingBranchMappings)
    .where(eq(sourceBindingBranchMappings.sourceBindingId, sourceBindingId));
  await executor.insert(sourceBindingBranchMappings).values(input);
}

export async function listBindingsBySourceIdsWithStatusesWithExecutor(
  executor: SourceReadExecutor,
  sourceIds: readonly string[],
  statuses: readonly SourceBindingStatus[],
): Promise<SourceBindingRow[]> {
  if (sourceIds.length === 0 || statuses.length === 0) {
    return [];
  }

  return await executor
    .select()
    .from(sourceBindings)
    .where(and(inArray(sourceBindings.sourceId, [...sourceIds]), inArray(sourceBindings.status, [...statuses])));
}

function compareBindingsByUpdatedAt(left: SourceBindingRow, right: SourceBindingRow): number {
  const updatedAtDiff: number = left.updatedAt.getTime() - right.updatedAt.getTime();
  if (updatedAtDiff !== 0) {
    return updatedAtDiff;
  }

  const createdAtDiff: number = left.createdAt.getTime() - right.createdAt.getTime();
  if (createdAtDiff !== 0) {
    return createdAtDiff;
  }

  return left.id.localeCompare(right.id);
}
