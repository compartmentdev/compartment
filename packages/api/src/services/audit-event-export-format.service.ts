import type { AuditEventSummary } from '@compartment/contracts';

const auditEventsCsvHeaders: string[] = [
  'id',
  'occurredAt',
  'eventType',
  'status',
  'actorEmail',
  'actorPrincipalId',
  'targetType',
  'targetId',
  'targetDisplayName',
  'metadata',
];

export function toAuditEventsNdjson(events: AuditEventSummary[]): string {
  return events.map((event: AuditEventSummary): string => JSON.stringify(event)).join('\n');
}

export function toAuditEventsCsv(events: AuditEventSummary[]): string {
  const rows: string[][] = [auditEventsCsvHeaders, ...events.map(toAuditEventCsvRow)];

  return rows.map(formatCsvRow).join('\n');
}

function toAuditEventCsvRow(event: AuditEventSummary): string[] {
  return [
    event.id,
    event.occurredAt,
    event.eventType,
    event.status,
    event.actor.email ?? '',
    event.actor.principalId ?? '',
    event.target.type,
    event.target.id,
    event.target.displayName ?? '',
    JSON.stringify(event.metadata),
  ];
}

function formatCsvRow(row: readonly string[]): string {
  return row.map(formatCsvCell).join(',');
}

function formatCsvCell(value: string): string {
  const safeValue: string = /^[=+\-@\t\r]/u.test(value) ? `'${value}` : value;
  if (!/[",\n\r]/u.test(safeValue)) {
    return safeValue;
  }

  return `"${safeValue.replaceAll('"', '""')}"`;
}
