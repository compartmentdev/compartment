import { and, asc, desc, eq, gt, inArray, type SQL } from 'drizzle-orm';
import { sourceEvents, sourceResolutionTasks } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import { requirePersistedRow } from './persisted-row.query.shared';
import { buildNonTerminalSourceResolutionTaskStatusFilter } from './source-resolution.query.support';
import type {
  CreateSourceEventInput,
  CreateOrGetSourceEventResult,
  PersistedSourceEventRow,
  SourceEventRow,
  SourceResolutionReadExecutor,
  SourceResolutionWriteExecutor,
  UpdateSourceEventStatusInput,
} from './source-resolution.query.types';

type SourceResolutionTaskFilter = SQL | undefined;

interface SourcePushEventRow {
  commitSha: string | null;
  sourceEventId: string;
}

export async function createOrGetSourceEvent(
  executor: SourceResolutionWriteExecutor,
  input: CreateSourceEventInput,
): Promise<CreateOrGetSourceEventResult> {
  const created: SourceEventRow | undefined = await insertSourceEvent(executor, input);
  if (created !== undefined) {
    return {
      created: true,
      event: created,
    };
  }

  return {
    created: false,
    event: requirePersistedRow(
      await findSourceEventBySourceAndDeliveryId(input.sourceId, input.providerDeliveryId),
      'source event',
    ),
  };
}

export async function updateSourceEventStatus(
  executor: SourceResolutionWriteExecutor,
  input: UpdateSourceEventStatusInput,
): Promise<SourceEventRow> {
  const [event]: PersistedSourceEventRow[] = await executor
    .update(sourceEvents)
    .set({
      ...(input.completedAt !== undefined ? { completedAt: input.completedAt } : {}),
      status: input.status,
      updatedAt: input.updatedAt,
    })
    .where(eq(sourceEvents.id, input.sourceEventId))
    .returning();

  return requirePersistedRow(event, 'source event');
}

export async function listNonTerminalSourceResolutionTaskEventIds(
  sourceEventIds: readonly string[],
): Promise<string[]> {
  return await listNonTerminalEventIdsByFilterWithExecutor(
    getApiDatabase(),
    buildNonTerminalEventIdsFilter(
      sourceEventIds.length === 0 ? undefined : inArray(sourceResolutionTasks.sourceEventId, [...sourceEventIds]),
    ),
  );
}

export async function listNonTerminalSourceResolutionTaskEventIdsBySourceIds(
  sourceIds: readonly string[],
): Promise<string[]> {
  return await listNonTerminalEventIdsByFilterWithExecutor(
    getApiDatabase(),
    buildNonTerminalEventIdsFilter(
      sourceIds.length === 0 ? undefined : inArray(sourceResolutionTasks.sourceId, [...sourceIds]),
    ),
  );
}

export async function listNonTerminalSourceResolutionTaskEventIdsWithExecutor(
  executor: SourceResolutionReadExecutor,
  sourceEventIds: readonly string[],
): Promise<string[]> {
  return await listNonTerminalEventIdsByFilterWithExecutor(
    executor,
    buildNonTerminalEventIdsFilter(
      sourceEventIds.length === 0 ? undefined : inArray(sourceResolutionTasks.sourceEventId, [...sourceEventIds]),
    ),
  );
}

export async function findLatestSourcePushEventSinceWithExecutor(
  executor: SourceResolutionReadExecutor,
  sourceId: string,
  branchName: string,
  createdAfter: Date,
): Promise<{ commitSha: string; sourceEventId: string } | undefined> {
  const row: SourcePushEventRow | undefined = await readLatestSourcePushEventSinceWithExecutor(
    executor,
    sourceId,
    branchName,
    createdAfter,
  );
  if (row?.commitSha === null || row === undefined) {
    return undefined;
  }

  return {
    commitSha: row.commitSha,
    sourceEventId: row.sourceEventId,
  };
}

async function readLatestSourcePushEventSinceWithExecutor(
  executor: SourceResolutionReadExecutor,
  sourceId: string,
  branchName: string,
  createdAfter: Date,
): Promise<SourcePushEventRow | undefined> {
  const rows: SourcePushEventRow[] = await executor
    .select({
      commitSha: sourceEvents.commitSha,
      sourceEventId: sourceEvents.id,
    })
    .from(sourceEvents)
    .where(buildSourcePushEventSinceFilter(sourceId, branchName, createdAfter))
    .orderBy(desc(sourceEvents.createdAt), desc(sourceEvents.id))
    .limit(1);

  return rows[0];
}

function buildSourcePushEventSinceFilter(sourceId: string, branchName: string, createdAfter: Date): SQL {
  return and(
    eq(sourceEvents.sourceId, sourceId),
    eq(sourceEvents.eventType, 'push'),
    eq(sourceEvents.branchName, branchName),
    gt(sourceEvents.createdAt, createdAfter),
  )!;
}

function buildNonTerminalEventIdsFilter(baseFilter: SQL | undefined): SQL | undefined {
  return baseFilter === undefined ? undefined : and(baseFilter, buildNonTerminalSourceResolutionTaskStatusFilter());
}

async function findSourceEventBySourceAndDeliveryId(
  sourceId: string,
  providerDeliveryId: string,
): Promise<SourceEventRow | undefined> {
  const rows: PersistedSourceEventRow[] = await getApiDatabase()
    .select()
    .from(sourceEvents)
    .where(and(eq(sourceEvents.sourceId, sourceId), eq(sourceEvents.providerDeliveryId, providerDeliveryId)))
    .limit(1);

  return rows[0];
}

async function insertSourceEvent(
  executor: SourceResolutionWriteExecutor,
  input: CreateSourceEventInput,
): Promise<SourceEventRow | undefined> {
  const [event]: PersistedSourceEventRow[] = await executor
    .insert(sourceEvents)
    .values(input)
    .onConflictDoNothing({
      target: [sourceEvents.sourceId, sourceEvents.providerDeliveryId],
    })
    .returning();

  return event;
}

async function listNonTerminalEventIdsByFilterWithExecutor(
  executor: SourceResolutionReadExecutor,
  filter: SourceResolutionTaskFilter,
): Promise<string[]> {
  if (filter === undefined) {
    return [];
  }

  const rows: { sourceEventId: string }[] = await executor
    .select({ sourceEventId: sourceResolutionTasks.sourceEventId })
    .from(sourceResolutionTasks)
    .where(filter)
    .orderBy(asc(sourceResolutionTasks.createdAt), asc(sourceResolutionTasks.id));

  return rows.map((row: { sourceEventId: string }): string => row.sourceEventId);
}
