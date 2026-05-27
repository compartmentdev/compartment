import type {
  AuditEventMetadata,
  AuditEventMetadataValue,
  AuditEventStatus,
  AuditEventSummary,
} from '@compartment/contracts/browser';
import type { JSX } from 'react';
import { BrowserTimestampTableCell } from '../../components/browser-timestamp';
import {
  ServerTable,
  ServerTableCell,
  ServerTableColumnGroup,
  ServerTableEmptyRow,
  ServerTableHeading,
  ServerTableRow,
  ServerTableSortableHeading,
  type ServerTableColumnDefinition,
} from '../../components/server-table';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import { StatusTag, type StatusTagVariant } from '../../components/ui/status-tag';
import type {
  BrowserAuditEventsPageResult,
  BrowserAuditEventsSortBy,
} from '../../services/browser-audit-events.service.types';
import { buildAuditEventsHref, readNextAuditEventsSortDirection } from './audit-events-query';

interface AuditEventsTableProps {
  data: BrowserAuditEventsPageResult;
  onNavigate?: BrowserSoftNavigateHandler | undefined;
}

interface AuditMetadataEntry {
  key: string;
  value: AuditEventMetadataValue;
}

const auditEventColumns: ServerTableColumnDefinition[] = [
  { className: 'w-[10.5rem]', key: 'time' },
  { className: 'w-[15rem]', key: 'event' },
  { className: 'w-[14rem]', key: 'actor' },
  { className: 'w-[15rem]', key: 'target' },
  { className: 'w-[11rem]', key: 'project' },
  { className: 'w-[7rem]', key: 'status' },
  { key: 'details' },
];

const auditMetadataPreviewLimit: number = 4;

export function AuditEventsTable({ data, onNavigate }: Readonly<AuditEventsTableProps>): JSX.Element {
  const navigate: BrowserSoftNavigateHandler = readAuditEventsNavigateHandler(onNavigate);
  return (
    <ServerTable minWidthClassName="min-w-[1120px]">
      <ServerTableColumnGroup columns={auditEventColumns} />
      <thead className="bg-background">
        <tr>
          <AuditEventsSortableHeading data={data} label="Time" onNavigate={navigate} sortBy="occurredAt" />
          <AuditEventsSortableHeading data={data} label="Event" onNavigate={navigate} sortBy="eventType" />
          <ServerTableHeading label="Actor" />
          <ServerTableHeading label="Target" />
          <ServerTableHeading label="Project" />
          <AuditEventsSortableHeading data={data} label="Status" onNavigate={navigate} sortBy="status" />
          <ServerTableHeading label="Details" />
        </tr>
      </thead>
      <tbody>{renderAuditEventRows(data.events)}</tbody>
    </ServerTable>
  );
}

function readAuditEventsNavigateHandler(
  onNavigate: BrowserSoftNavigateHandler | undefined,
): BrowserSoftNavigateHandler {
  return onNavigate ?? readNoopNavigate;
}

function readNoopNavigate(): void {
  return undefined;
}

function AuditEventsSortableHeading({
  data,
  label,
  onNavigate,
  sortBy,
}: Readonly<{
  data: BrowserAuditEventsPageResult;
  label: string;
  onNavigate: BrowserSoftNavigateHandler;
  sortBy: BrowserAuditEventsSortBy;
}>): JSX.Element {
  return (
    <ServerTableSortableHeading
      href={buildAuditEventsHref(data, {
        page: 1,
        sortBy,
        sortDirection: readNextAuditEventsSortDirection(data, sortBy),
      })}
      label={label}
      onNavigate={onNavigate}
      sortDirection={data.sortBy === sortBy ? data.sortDirection : undefined}
    />
  );
}

function renderAuditEventRows(events: AuditEventSummary[]): JSX.Element[] {
  if (events.length === 0) {
    return [<ServerTableEmptyRow colSpan={7} key="empty" message="No audit events found." />];
  }

  return events.map(renderAuditEventRow);
}

function renderAuditEventRow(event: AuditEventSummary): JSX.Element {
  return (
    <ServerTableRow key={event.id}>
      <BrowserTimestampTableCell emptyLabel="Not recorded" value={event.occurredAt} />
      {renderAuditEventTypeCell(event)}
      {renderAuditActorCell(event)}
      {renderAuditTargetCell(event)}
      {renderAuditProjectCell(event)}
      {renderAuditStatusCell(event.status)}
      <ServerTableCell>{renderAuditMetadata(event.metadata)}</ServerTableCell>
    </ServerTableRow>
  );
}

function renderAuditEventTypeCell(event: AuditEventSummary): JSX.Element {
  return (
    <ServerTableCell>
      <span className="block text-[13px] font-semibold text-foreground">{formatAuditEventType(event.eventType)}</span>
    </ServerTableCell>
  );
}

function renderAuditActorCell(event: AuditEventSummary): JSX.Element {
  return (
    <ServerTableCell>
      <span className="block truncate font-medium">{readAuditActorLabel(event)}</span>
      <span className="mt-1 block truncate text-[12px] text-muted-foreground">{readAuditActorDetail(event)}</span>
    </ServerTableCell>
  );
}

function renderAuditTargetCell(event: AuditEventSummary): JSX.Element {
  return (
    <ServerTableCell>
      <span className="block truncate font-medium">{event.target.displayName ?? event.target.id}</span>
      <span className="mt-1 block truncate text-[12px] text-muted-foreground">
        {event.target.type} / {event.target.id}
      </span>
    </ServerTableCell>
  );
}

function renderAuditProjectCell(event: AuditEventSummary): JSX.Element {
  return (
    <ServerTableCell>
      <span className="block truncate">{event.target.projectId ?? 'No project'}</span>
    </ServerTableCell>
  );
}

function renderAuditStatusCell(status: AuditEventStatus): JSX.Element {
  return (
    <ServerTableCell>
      <StatusTag
        icon={readAuditStatusIcon(status)}
        label={formatAuditStatus(status)}
        variant={readAuditStatusVariant(status)}
      />
    </ServerTableCell>
  );
}

function renderAuditMetadata(metadata: AuditEventMetadata): JSX.Element {
  const entries: AuditMetadataEntry[] = Object.entries(metadata).map(
    ([key, value]: [string, AuditEventMetadataValue]): AuditMetadataEntry => ({ key, value }),
  );

  if (entries.length === 0) {
    return <span className="text-[12px] text-muted-foreground">No metadata</span>;
  }

  const visibleEntries: AuditMetadataEntry[] = entries.slice(0, auditMetadataPreviewLimit);
  const hiddenCount: number = entries.length - visibleEntries.length;

  return (
    <div className="flex flex-wrap gap-1.5">
      {visibleEntries.map(renderAuditMetadataChip)}
      {hiddenCount > 0 ? <span className={readAuditMetadataChipClassName()}>+{hiddenCount}</span> : null}
    </div>
  );
}

function renderAuditMetadataChip(entry: AuditMetadataEntry): JSX.Element {
  return (
    <span
      className={readAuditMetadataChipClassName()}
      key={entry.key}
      title={`${entry.key}: ${formatAuditMetadataValue(entry.value)}`}
    >
      <span className="font-medium text-foreground/80">{entry.key}</span>
      <span className="max-w-[12rem] truncate">{formatAuditMetadataValue(entry.value)}</span>
    </span>
  );
}

function readAuditMetadataChipClassName(): string {
  return 'inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-muted px-2 py-1 text-[11px] leading-4 text-muted-foreground';
}

function readAuditActorLabel(event: AuditEventSummary): string {
  return event.actor.email ?? event.actor.principalId ?? event.actor.type;
}

function readAuditActorDetail(event: AuditEventSummary): string {
  return event.actor.sourceIp ?? event.actor.transport ?? event.actor.type;
}

function readAuditStatusVariant(status: AuditEventStatus): StatusTagVariant {
  return status === 'succeeded' ? 'success' : 'error';
}

function readAuditStatusIcon(status: AuditEventStatus): 'failed' | 'succeeded' {
  return status === 'succeeded' ? 'succeeded' : 'failed';
}

function formatAuditEventType(eventType: string): string {
  return eventType
    .replaceAll('.', ' ')
    .replaceAll('_', ' ')
    .replace(/^\w/u, (value: string): string => value.toUpperCase());
}

function formatAuditStatus(status: AuditEventStatus): string {
  return status === 'succeeded' ? 'Succeeded' : 'Failed';
}

function formatAuditMetadataValue(value: AuditEventMetadataValue): string {
  if (value === null) {
    return 'null';
  }

  return String(value);
}
