import {
  auditEventListResponseSchema,
  type AuditEventActorSummary,
  type AuditEventSummary,
  type AuditEventTargetSummary,
  type AuditRetentionEffectivePolicy,
} from '@compartment/contracts';
import { createAuditExportTooLargeError } from '../errors/api-business-error';
import { findOrganizationSettings } from '../queries/organization-settings.query';
import type { OrganizationSettingsRow } from '../queries/organization-settings.query.types';
import {
  auditEventExportRowLimit,
  insertAuditEvent,
  insertAuditEventWithExecutor,
  listAuditEventsForExport,
  listAuditEventsPage,
} from '../queries/audit-events.query';
import type {
  AuditEventExportPage,
  AuditEventFilterInput,
  AuditEventPage,
  AuditEventRow,
  InsertAuditEventInput,
} from '../queries/audit-events.query.types';
import { toAuditEventsCsv, toAuditEventsNdjson } from './audit-event-export-format.service';
import { writeAuditEventToLocalFileSink } from './audit-event-file-sink.service';
import { sanitizeAuditEventMetadata } from './audit-event-metadata.service';
import {
  buildConfiguredAuditRetentionPolicy,
  resolveEffectiveAuditRetentionPolicy,
} from './audit-retention-policy.service';
import type {
  AuditEventListResult,
  AuditEventResult,
  ExportOrganizationAuditEventsInput,
  ListOrganizationAuditEventsInput,
  OrganizationAuditEventsExportContent,
  OrganizationAuditEventFilterInput,
  RecordAuditEventInput,
} from './audit-events.service.types';

export async function recordAuditEvent(input: RecordAuditEventInput): Promise<AuditEventResult> {
  const insertInput: InsertAuditEventInput = toInsertAuditEventInput(input);
  const row: AuditEventRow =
    input.executor === undefined
      ? await insertAuditEvent(insertInput)
      : await insertAuditEventWithExecutor(input.executor, insertInput);
  const event: AuditEventResult = toAuditEventSummary(row);
  if (input.executor === undefined) {
    writeAuditEventToLocalFileSink(event);
  }

  return event;
}

export function writeCommittedAuditEventsToLocalFileSink(events: readonly AuditEventResult[]): void {
  for (const event of events) {
    writeAuditEventToLocalFileSink(event);
  }
}

export async function listOrganizationAuditEvents(
  input: ListOrganizationAuditEventsInput,
): Promise<AuditEventListResult> {
  const filter: AuditEventFilterInput = await toRetainedAuditEventFilter(input);
  const page: AuditEventPage = await listAuditEventsPage({
    ...filter,
    page: input.page ?? 1,
    perPage: input.perPage ?? 100,
  });

  return auditEventListResponseSchema.parse({
    events: page.events.map(toAuditEventSummary),
    pagination: page.pagination,
  });
}

export async function exportOrganizationAuditEvents(input: ExportOrganizationAuditEventsInput): Promise<string> {
  const content: OrganizationAuditEventsExportContent = await buildOrganizationAuditEventsExport(input);

  return content.content;
}

async function buildOrganizationAuditEventsExport(
  input: ExportOrganizationAuditEventsInput,
): Promise<OrganizationAuditEventsExportContent> {
  const page: AuditEventExportPage = await listAuditEventsForExport(await toRetainedAuditEventFilter(input));
  assertAuditEventExportComplete(page);
  const events: AuditEventSummary[] = page.events.map(toAuditEventSummary);

  return {
    content: input.format === 'csv' ? toAuditEventsCsv(events) : toAuditEventsNdjson(events),
    rowCount: events.length,
  };
}

function toInsertAuditEventInput(input: RecordAuditEventInput): InsertAuditEventInput {
  return {
    actorEmail: input.actor.email,
    actorPrincipalId: input.actor.principalId,
    actorType: input.actor.type,
    authSessionId: input.actor.sessionId,
    authTransport: input.actor.transport,
    environmentId: input.target.environmentId,
    eventType: input.eventType,
    metadata: sanitizeAuditEventMetadata(input.metadata),
    organizationId: input.organizationId,
    projectId: input.target.projectId,
    projectServiceId: input.target.serviceId,
    scopeType: 'organization',
    sourceIp: input.actor.sourceIp,
    status: input.status ?? 'succeeded',
    targetDisplayName: input.target.displayName,
    targetId: input.target.id,
    targetType: input.target.type,
    userAgent: input.actor.userAgent,
  };
}

function toAuditEventSummary(row: AuditEventRow): AuditEventSummary {
  return {
    actor: toAuditEventActorSummary(row),
    eventType: row.eventType,
    id: row.id,
    metadata: row.metadata,
    occurredAt: row.occurredAt.toISOString(),
    organizationId: row.organizationId,
    scopeType: row.scopeType,
    status: row.status,
    target: toAuditEventTargetSummary(row),
  };
}

function toAuditEventActorSummary(row: AuditEventRow): AuditEventActorSummary {
  return {
    email: row.actorEmail,
    principalId: row.actorPrincipalId,
    sessionId: row.authSessionId,
    sourceIp: row.sourceIp,
    transport: row.authTransport,
    type: row.actorType,
    userAgent: row.userAgent,
  };
}

function toAuditEventTargetSummary(row: AuditEventRow): AuditEventTargetSummary {
  return {
    displayName: row.targetDisplayName,
    environmentId: row.environmentId,
    id: row.targetId,
    projectId: row.projectId,
    serviceId: row.projectServiceId,
    type: row.targetType,
  };
}

async function toRetainedAuditEventFilter(input: OrganizationAuditEventFilterInput): Promise<AuditEventFilterInput> {
  const retentionStart: Date | undefined = await readAuditRetentionStart(input.organizationId);

  return {
    actor: input.actor,
    eventType: input.eventType,
    from: readLatestDate(toOptionalDate(input.from), retentionStart),
    organizationId: input.organizationId,
    orderBy: input.orderBy,
    project: input.project,
    sort: input.sort,
    targetType: input.targetType,
    to: toOptionalDate(input.to),
  };
}

async function readAuditRetentionStart(organizationId: string): Promise<Date | undefined> {
  const settings: OrganizationSettingsRow | undefined = await findOrganizationSettings(organizationId);
  if (settings === undefined) {
    throw new Error('Expected organization settings.');
  }
  const effective: AuditRetentionEffectivePolicy = resolveEffectiveAuditRetentionPolicy(
    buildConfiguredAuditRetentionPolicy(settings),
  );
  if (effective.mode === 'indefinite') {
    return undefined;
  }

  return new Date(Date.now() - requireAuditRetentionDays(effective.days) * 24 * 60 * 60 * 1000);
}

function readLatestDate(left: Date | undefined, right: Date | undefined): Date | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;

  return left > right ? left : right;
}

function requireAuditRetentionDays(days: number | null): number {
  if (days === null) {
    throw new Error('Expected audit retention days.');
  }

  return days;
}

function assertAuditEventExportComplete(page: AuditEventExportPage): void {
  if (!page.hasMore) {
    return;
  }

  throw createAuditExportTooLargeError(
    `Audit export is limited to ${auditEventExportRowLimit} events. Narrow the time range or filters.`,
  );
}

function toOptionalDate(value: string | undefined): Date | undefined {
  return value === undefined ? undefined : new Date(value);
}
