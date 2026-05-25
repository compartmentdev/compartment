import { auditEventTypeOptions, type AuditEventType } from '@compartment/contracts/browser';
import { hasText } from '@compartment/utils';
import type { FormEvent, JSX } from 'react';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import { BrowserSoftNavigationLink } from '../../components/browser-soft-navigation-link';
import { BrowserConsoleShell } from '../../components/browser-console-header';
import { Select } from '../../components/select';
import { ServerTableFrame } from '../../components/server-table';
import { ServerTableControls } from '../../components/server-table-controls';
import { Button, buttonVariants } from '../../components/ui/button';
import { Filter, RotateCcw } from '../../components/ui/icons';
import { Input } from '../../components/ui/input';
import { readFormString } from '../../lib/form-data';
import { cn } from '../../lib/utils';
import { readBrowserTablePageSize } from '../../lib/server-table-query';
import type {
  BrowserAuditEventFilters,
  BrowserAuditEventsPageResult,
} from '../../services/browser-audit-events.service.types';
import { readBrowserConsoleOrganizationControl } from '../console/console-organization-control';
import { AuditEventsOrganizationContextPanel } from './audit-events-organization-context-panel';
import { auditTargetTypeOptions, type AuditTargetTypeOption } from './audit-events-filter-options';
import { buildAuditEventsHref, buildAuditEventsResetHref } from './audit-events-query';
import { AuditEventsTable } from './audit-events-table';

interface AuditEventsViewProps {
  data: BrowserAuditEventsPageResult;
  onNavigate: BrowserSoftNavigateHandler;
}

interface AuditEventsFilterFormProps {
  data: BrowserAuditEventsPageResult;
  onNavigate: BrowserSoftNavigateHandler;
}

interface AuditEventsFilterFieldProps {
  children: JSX.Element;
  label: string;
}

interface AuditEventsTableSectionProps {
  data: BrowserAuditEventsPageResult;
  onNavigate: BrowserSoftNavigateHandler;
}

export function AuditEventsView({ data, onNavigate }: Readonly<AuditEventsViewProps>): JSX.Element {
  const organizationControl: JSX.Element | null = readOrganizationControl(data, onNavigate);

  return (
    <BrowserConsoleShell
      currentOrganizationPermissions={data.currentOrganizationPermissions}
      organizationControl={organizationControl}
      onNavigate={onNavigate}
      page="audit"
      principalEmail={data.principalEmail}
      selectedOrganizationSlug={data.selectedOrganizationSlug}
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5">
        {renderAuditEventsContent(data, onNavigate)}
      </div>
    </BrowserConsoleShell>
  );
}

function renderAuditEventsContent(
  data: BrowserAuditEventsPageResult,
  onNavigate: BrowserSoftNavigateHandler,
): JSX.Element {
  if (data.organizationContext.kind !== 'selected') {
    return (
      <AuditEventsOrganizationContextPanel context={data.organizationContext} data={data} onNavigate={onNavigate} />
    );
  }

  return (
    <>
      <AuditEventsFilterForm data={data} key={readAuditEventsFilterFormKey(data.filters)} onNavigate={onNavigate} />
      <AuditEventsTableSection data={data} onNavigate={onNavigate} />
    </>
  );
}

function readOrganizationControl(
  data: BrowserAuditEventsPageResult,
  onNavigate: BrowserSoftNavigateHandler,
): JSX.Element | null {
  return readBrowserConsoleOrganizationControl(
    data.organizations,
    data.selectedOrganizationSlug,
    data.showOrganizationSelector,
    (organizationSlug: string): void => {
      onNavigate(buildAuditEventsHref(data, { page: 1, selectedOrganizationSlug: organizationSlug }));
    },
  );
}

function AuditEventsFilterForm({ data, onNavigate }: Readonly<AuditEventsFilterFormProps>): JSX.Element {
  return (
    <form
      className="grid gap-3 rounded-lg border border-border bg-card p-4 md:grid-cols-2 xl:grid-cols-4"
      onSubmit={(event: FormEvent<HTMLFormElement>): void => {
        handleAuditEventsFilterSubmit(event, data, onNavigate);
      }}
    >
      {renderAuditEventsFilterFields(data.filters)}
      {renderAuditEventsFilterActions(data, onNavigate)}
    </form>
  );
}

function readAuditEventsFilterFormKey(filters: BrowserAuditEventFilters): string {
  return `${filters.from}|${filters.to}|${filters.eventType}|${filters.actor}|${filters.targetType}|${filters.project}`;
}

function renderAuditEventsFilterFields(filters: BrowserAuditEventFilters): JSX.Element[] {
  return [
    <AuditEventsFilterField key="from" label="From">
      <Input defaultValue={filters.from} name="from" type="datetime-local" />
    </AuditEventsFilterField>,
    <AuditEventsFilterField key="to" label="To">
      <Input defaultValue={filters.to} name="to" type="datetime-local" />
    </AuditEventsFilterField>,
    renderAuditEventTypeField(filters.eventType),
    <AuditEventsFilterField key="actor" label="Actor">
      <Input defaultValue={filters.actor} name="actor" placeholder="Email or principal" />
    </AuditEventsFilterField>,
    renderAuditTargetTypeField(filters.targetType),
    <AuditEventsFilterField key="project" label="Project ID">
      <Input defaultValue={filters.project} name="project" placeholder="prj_..." />
    </AuditEventsFilterField>,
  ];
}

function renderAuditEventTypeField(eventType: string): JSX.Element {
  return (
    <AuditEventsFilterField key="eventType" label="Event">
      <Select defaultValue={eventType} name="eventType">
        <option value="">All events</option>
        {auditEventTypeOptions.map(renderAuditEventTypeOption)}
      </Select>
    </AuditEventsFilterField>
  );
}

function renderAuditTargetTypeField(targetType: string): JSX.Element {
  return (
    <AuditEventsFilterField key="targetType" label="Target">
      <Select defaultValue={targetType} name="targetType">
        <option value="">All targets</option>
        {auditTargetTypeOptions.map(renderAuditTargetTypeOption)}
      </Select>
    </AuditEventsFilterField>
  );
}

function renderAuditTargetTypeOption(option: AuditTargetTypeOption): JSX.Element {
  return (
    <option key={option.value} value={option.value}>
      {option.label}
    </option>
  );
}

function renderAuditEventsFilterActions(
  data: BrowserAuditEventsPageResult,
  onNavigate: BrowserSoftNavigateHandler,
): JSX.Element {
  return (
    <div className="flex items-end gap-2 md:col-span-2 xl:col-span-2">
      <Button className="min-w-[6.5rem]" type="submit">
        <Filter aria-hidden="true" className="size-4" />
        Apply
      </Button>
      <BrowserSoftNavigationLink
        className={cn(buttonVariants({ variant: 'outline' }), 'no-underline')}
        href={buildAuditEventsResetHref(data)}
        onNavigate={onNavigate}
      >
        <RotateCcw aria-hidden="true" className="size-4" />
        Reset
      </BrowserSoftNavigationLink>
    </div>
  );
}

function AuditEventsFilterField({ children, label }: Readonly<AuditEventsFilterFieldProps>): JSX.Element {
  return (
    <label className="grid gap-1.5">
      <span className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function AuditEventsTableSection({ data, onNavigate }: Readonly<AuditEventsTableSectionProps>): JSX.Element {
  return (
    <ServerTableFrame>
      <AuditEventsTable data={data} />
      <ServerTableControls
        currentPage={data.page}
        itemLabel="audit event"
        nextPageHref={readNextPageHref(data)}
        onNavigate={onNavigate}
        onPageSizeChange={(value: string): void => {
          onNavigate(buildAuditEventsHref(data, { page: 1, pageSize: readBrowserTablePageSize(value) }));
        }}
        pageSize={String(data.pageSize)}
        pageSizeOptions={data.pageSizeOptions.map(String)}
        previousPageHref={readPreviousPageHref(data)}
        totalItems={data.totalEvents}
        totalPages={data.totalPages}
      />
    </ServerTableFrame>
  );
}

function renderAuditEventTypeOption(eventType: AuditEventType): JSX.Element {
  return (
    <option key={eventType} value={eventType}>
      {eventType}
    </option>
  );
}

function handleAuditEventsFilterSubmit(
  event: FormEvent<HTMLFormElement>,
  data: BrowserAuditEventsPageResult,
  onNavigate: BrowserSoftNavigateHandler,
): void {
  event.preventDefault();
  const formData: FormData = new FormData(event.currentTarget);
  const filters: BrowserAuditEventFilters = {
    actor: readFilterFormValue(formData, 'actor'),
    eventType: readFilterEventType(formData),
    from: readFilterFormValue(formData, 'from'),
    project: readFilterFormValue(formData, 'project'),
    targetType: readFilterFormValue(formData, 'targetType'),
    to: readFilterFormValue(formData, 'to'),
  };

  onNavigate(buildAuditEventsHref(data, { ...filters, page: 1 }));
}

function readFilterEventType(formData: FormData): AuditEventType | '' {
  const eventType: string = readFilterFormValue(formData, 'eventType');
  if (!hasText(eventType)) {
    return '';
  }

  return auditEventTypeOptions.includes(eventType as AuditEventType) ? (eventType as AuditEventType) : '';
}

function readFilterFormValue(formData: FormData, name: string): string {
  return readFormString(formData, name).trim();
}

function readPreviousPageHref(data: BrowserAuditEventsPageResult): string | null {
  return data.page > 1 ? buildAuditEventsHref(data, { page: data.page - 1 }) : null;
}

function readNextPageHref(data: BrowserAuditEventsPageResult): string | null {
  return data.page < data.totalPages ? buildAuditEventsHref(data, { page: data.page + 1 }) : null;
}
