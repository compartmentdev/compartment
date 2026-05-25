import type {
  AuditEventActorType,
  AuditEventMetadata,
  AuditEventScopeType,
  AuditEventStatus,
  AuditEventType,
  AuditRetentionMode,
} from '@compartment/contracts';
import { and, count, desc, eq, gte, lte, or, sql, type SQL } from 'drizzle-orm';
import { auditEvents, organizations } from '../db/schema';
import { createId } from '../lib/tokens';
import { getApiDatabase } from '../runtime/runtime-access';
import type {
  AuditRetentionCleanupCandidateRow,
  AuditEventFilterInput,
  AuditEventExportPage,
  AuditEventPage,
  AuditEventRow,
  AuditEventWriteExecutor,
  DeleteExpiredAuditEventsBatchInput,
  InsertAuditEventInput,
  ListAuditEventsPageInput,
} from './audit-events.query.types';
import { buildPrincipalEmailLookup } from './principal-email.query.helpers';

export const auditEventExportRowLimit: number = 10_000;

interface StoredAuditEventRow {
  actorEmail: string | null;
  actorPrincipalId: string | null;
  actorType: string;
  authSessionId: string | null;
  authTransport: string | null;
  environmentId: string | null;
  eventType: string;
  id: string;
  metadataJson: string;
  occurredAt: Date;
  organizationId: string | null;
  projectId: string | null;
  projectServiceId: string | null;
  scopeType: string;
  sourceIp: string | null;
  status: string;
  targetDisplayName: string | null;
  targetId: string;
  targetType: string;
  userAgent: string | null;
}

interface AuditRetentionCleanupCandidateQueryRow {
  auditRetentionDays: number | null;
  auditRetentionMode: string;
  organizationId: string;
}

interface AuditEventDeleteBatchResult {
  rows: object[];
}

const auditRetentionCleanupCandidateSelection: {
  auditRetentionDays: typeof organizations.auditRetentionDays;
  auditRetentionMode: typeof organizations.auditRetentionMode;
  organizationId: typeof organizations.id;
} = {
  auditRetentionDays: organizations.auditRetentionDays,
  auditRetentionMode: organizations.auditRetentionMode,
  organizationId: organizations.id,
};

export async function insertAuditEvent(input: InsertAuditEventInput): Promise<AuditEventRow> {
  return await insertAuditEventWithExecutor(getApiDatabase(), input);
}

export async function insertAuditEventWithExecutor(
  executor: AuditEventWriteExecutor,
  input: InsertAuditEventInput,
): Promise<AuditEventRow> {
  const [row] = (await executor
    .insert(auditEvents)
    .values(buildAuditEventInsertRecord(input))
    .returning()) as StoredAuditEventRow[];

  if (row === undefined) {
    throw new Error('Failed to persist audit event.');
  }

  return toAuditEventRow(row);
}

export async function listAuditEventsPage(input: ListAuditEventsPageInput): Promise<AuditEventPage> {
  const totalItems: number = await countAuditEvents(input);
  const totalPages: number = Math.max(1, Math.ceil(totalItems / input.perPage));
  const page: number = Math.min(input.page, totalPages);
  const rows: StoredAuditEventRow[] = await readAuditEvents(input, input.perPage, (page - 1) * input.perPage);

  return {
    events: rows.map(toAuditEventRow),
    pagination: {
      page,
      perPage: input.perPage,
      totalItems,
      totalPages,
    },
  };
}

export async function listAuditEventsForExport(input: AuditEventFilterInput): Promise<AuditEventExportPage> {
  const rows: StoredAuditEventRow[] = await readAuditEvents(input, auditEventExportRowLimit + 1, 0);

  return {
    events: rows.slice(0, auditEventExportRowLimit).map(toAuditEventRow),
    hasMore: rows.length > auditEventExportRowLimit,
  };
}

export async function listAuditRetentionCleanupCandidates(): Promise<AuditRetentionCleanupCandidateRow[]> {
  const rows: AuditRetentionCleanupCandidateQueryRow[] = await getApiDatabase()
    .select(auditRetentionCleanupCandidateSelection)
    .from(organizations);

  return rows.map(toAuditRetentionCleanupCandidateRow);
}

export async function deleteExpiredAuditEventsBatch(input: DeleteExpiredAuditEventsBatchInput): Promise<number> {
  const result: AuditEventDeleteBatchResult = await getApiDatabase().execute(sql`
      WITH expired_audit_events AS (
        SELECT ${auditEvents.id}
        FROM ${auditEvents}
        WHERE ${auditEvents.scopeType} = 'organization'
          AND ${auditEvents.organizationId} = ${input.organizationId}
          AND ${auditEvents.occurredAt} < ${input.occurredBefore}
        ORDER BY ${auditEvents.occurredAt} ASC, ${auditEvents.id} ASC
        LIMIT ${input.limit}
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM ${auditEvents}
      USING expired_audit_events
      WHERE ${auditEvents.id} = expired_audit_events.id
      RETURNING ${auditEvents.id}
    `);

  return result.rows.length;
}

async function readAuditEvents(
  input: AuditEventFilterInput,
  limit: number,
  offset: number,
): Promise<StoredAuditEventRow[]> {
  return await getApiDatabase()
    .select()
    .from(auditEvents)
    .where(buildAuditEventFilter(input))
    .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
    .limit(limit)
    .offset(offset);
}

async function countAuditEvents(input: AuditEventFilterInput): Promise<number> {
  const rows: { value: number }[] = await getApiDatabase()
    .select({ value: count() })
    .from(auditEvents)
    .where(buildAuditEventFilter(input));

  return rows[0]?.value ?? 0;
}

function buildAuditEventFilter(input: AuditEventFilterInput): SQL {
  const filters: SQL[] = [
    eq(auditEvents.organizationId, input.organizationId),
    eq(auditEvents.scopeType, 'organization'),
  ];
  appendAuditEventTimeFilters(filters, input);
  appendAuditEventAttributeFilters(filters, input);

  return and(...filters)!;
}

function buildAuditEventInsertRecord(input: InsertAuditEventInput): StoredAuditEventRow {
  return {
    actorEmail: input.actorEmail ?? null,
    actorPrincipalId: input.actorPrincipalId ?? null,
    actorType: input.actorType,
    authSessionId: input.authSessionId ?? null,
    authTransport: input.authTransport ?? null,
    environmentId: input.environmentId ?? null,
    eventType: input.eventType,
    id: createId('aud'),
    metadataJson: JSON.stringify(input.metadata),
    occurredAt: input.occurredAt ?? new Date(),
    organizationId: input.organizationId ?? null,
    projectId: input.projectId ?? null,
    projectServiceId: input.projectServiceId ?? null,
    scopeType: input.scopeType,
    sourceIp: input.sourceIp ?? null,
    status: input.status,
    targetDisplayName: input.targetDisplayName ?? null,
    targetId: input.targetId,
    targetType: input.targetType,
    userAgent: input.userAgent ?? null,
  };
}

function appendAuditEventTimeFilters(filters: SQL[], input: AuditEventFilterInput): void {
  if (input.from !== undefined) filters.push(gte(auditEvents.occurredAt, input.from));
  if (input.to !== undefined) filters.push(lte(auditEvents.occurredAt, input.to));
}

function appendAuditEventAttributeFilters(filters: SQL[], input: AuditEventFilterInput): void {
  if (input.eventType !== undefined) filters.push(eq(auditEvents.eventType, input.eventType));
  if (input.actor !== undefined) filters.push(buildAuditEventActorFilter(input.actor));
  if (input.targetType !== undefined) filters.push(eq(auditEvents.targetType, input.targetType));
  if (input.project !== undefined) filters.push(eq(auditEvents.projectId, input.project));
}

function buildAuditEventActorFilter(actor: string): SQL {
  return or(eq(auditEvents.actorPrincipalId, actor), buildPrincipalEmailLookup(actor, auditEvents.actorEmail))!;
}

function toAuditEventRow(row: StoredAuditEventRow): AuditEventRow {
  return {
    actorEmail: row.actorEmail,
    actorPrincipalId: row.actorPrincipalId,
    actorType: row.actorType as AuditEventActorType,
    authSessionId: row.authSessionId,
    authTransport: row.authTransport,
    environmentId: row.environmentId,
    eventType: row.eventType as AuditEventType,
    id: row.id,
    metadata: parseAuditEventMetadata(row.metadataJson),
    occurredAt: row.occurredAt,
    organizationId: row.organizationId,
    projectId: row.projectId,
    projectServiceId: row.projectServiceId,
    scopeType: row.scopeType as AuditEventScopeType,
    sourceIp: row.sourceIp,
    status: row.status as AuditEventStatus,
    targetDisplayName: row.targetDisplayName,
    targetId: row.targetId,
    targetType: row.targetType,
    userAgent: row.userAgent,
  };
}

function toAuditRetentionCleanupCandidateRow(
  row: AuditRetentionCleanupCandidateQueryRow,
): AuditRetentionCleanupCandidateRow {
  return {
    auditRetentionDays: row.auditRetentionDays,
    auditRetentionMode: row.auditRetentionMode as AuditRetentionMode,
    organizationId: row.organizationId,
  };
}

function parseAuditEventMetadata(metadataJson: string): AuditEventMetadata {
  return JSON.parse(metadataJson) as AuditEventMetadata;
}
