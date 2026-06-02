import type { JSX } from 'react';
import { readBrowserConsoleEnvironmentLabel } from '../../components/browser-console-detail-header';
import { BrowserTimestampTableCell } from '../../components/browser-timestamp';
import {
  readServerTableClosedBadgeClassName,
  ServerTable,
  ServerTableCell,
  ServerTableEmptyRow,
  ServerTableFrame,
  ServerTableHeading,
  ServerTableRow,
} from '../../components/server-table';
import { ServerTableControls } from '../../components/server-table-controls';
import type {
  BrowserProjectOverviewPageResult,
  BrowserProjectOverviewService,
} from '../../services/browser-project-overview.service.types';
import { closedProjectRouteLabel } from './project-route-labels';
import { projectNoDeploymentsLabel } from './project-deployment-labels';
import { ProjectStatusBadge } from './project-status-badge';

interface ProjectOverviewServicesTableProps {
  data: BrowserProjectOverviewPageResult;
}

interface ProjectOverviewServiceRowProps {
  service: BrowserProjectOverviewService;
  showEnvironmentColumn: boolean;
}

export function ProjectOverviewServicesTable({ data }: Readonly<ProjectOverviewServicesTableProps>): JSX.Element {
  return (
    <ServerTableFrame className="flex min-h-[calc(100vh-300px)] flex-1 flex-col">
      {renderProjectOverviewServicesTable(data)}
      {renderProjectOverviewServicesControls(data.services.length)}
    </ServerTableFrame>
  );
}

function renderProjectOverviewServicesTable(data: BrowserProjectOverviewPageResult): JSX.Element {
  return (
    <div className="flex-1">
      <ServerTable minWidthClassName="min-w-[760px]">
        <thead className="bg-card">
          <tr>
            {renderProjectOverviewEnvironmentHeading(data)}
            <ServerTableHeading label="Service" />
            <ServerTableHeading label="Kind" />
            <ServerTableHeading label="Status" />
            <ServerTableHeading label="Route" />
            <ServerTableHeading label="Last deploy" />
          </tr>
        </thead>
        <tbody>{renderProjectOverviewServiceRows(data)}</tbody>
      </ServerTable>
    </div>
  );
}

function renderProjectOverviewServicesControls(totalServices: number): JSX.Element {
  return (
    <ServerTableControls
      currentPage={1}
      itemLabel="service"
      nextPageHref={null}
      onPageSizeChange={ignoreProjectOverviewPageSizeChange}
      pageSize={String(totalServices)}
      pageSizeOptions={[]}
      previousPageHref={null}
      showPageSize={false}
      totalItems={totalServices}
      totalPages={1}
    />
  );
}

function ignoreProjectOverviewPageSizeChange(): void {
  return;
}

function renderProjectOverviewServiceRows(data: BrowserProjectOverviewPageResult): JSX.Element[] {
  if (data.services.length === 0) {
    return [
      <ServerTableEmptyRow
        colSpan={readProjectOverviewServicesColumnCount(data)}
        key="empty"
        message={readProjectOverviewServicesEmptyMessage(data)}
      />,
    ];
  }

  return data.services.map(
    (service: BrowserProjectOverviewService): JSX.Element => (
      <ProjectOverviewServiceRow
        key={`${service.environmentName}:${service.name}`}
        service={service}
        showEnvironmentColumn={data.selectedEnvironmentName === null}
      />
    ),
  );
}

function ProjectOverviewServiceRow({
  service,
  showEnvironmentColumn,
}: Readonly<ProjectOverviewServiceRowProps>): JSX.Element {
  return (
    <ServerTableRow>
      {renderProjectOverviewServiceEnvironmentCell(service, showEnvironmentColumn)}
      <ServerTableCell>{renderProjectOverviewServiceName(service.name)}</ServerTableCell>
      <ServerTableCell>{service.kind}</ServerTableCell>
      <ServerTableCell>
        <ProjectStatusBadge status={service.status} />
      </ServerTableCell>
      <ServerTableCell>{renderProjectOverviewRoute(service.routeUrl)}</ServerTableCell>
      <BrowserTimestampTableCell emptyLabel={projectNoDeploymentsLabel} value={service.lastDeploymentCreatedAt} />
    </ServerTableRow>
  );
}

function renderProjectOverviewEnvironmentHeading(data: Readonly<BrowserProjectOverviewPageResult>): JSX.Element | null {
  return data.selectedEnvironmentName === null ? <ServerTableHeading label="Environment" /> : null;
}

function renderProjectOverviewServiceEnvironmentCell(
  service: Readonly<BrowserProjectOverviewService>,
  showEnvironmentColumn: boolean,
): JSX.Element | null {
  return showEnvironmentColumn ? (
    <ServerTableCell>{readProjectOverviewEnvironmentLabel(service.environmentName)}</ServerTableCell>
  ) : null;
}

function renderProjectOverviewServiceName(name: string): JSX.Element {
  return (
    <p className="text-[13px] font-medium text-foreground" data-testid="project-overview-service-name">
      {name}
    </p>
  );
}

function renderProjectOverviewRoute(routeUrl: string | null): JSX.Element {
  if (routeUrl === null) {
    return <span className={readServerTableClosedBadgeClassName()}>{closedProjectRouteLabel}</span>;
  }

  return (
    <a
      className="text-[13px] text-foreground underline underline-offset-2"
      href={routeUrl}
      rel="noreferrer"
      target="_blank"
    >
      Open
    </a>
  );
}

function readProjectOverviewServicesColumnCount(data: Readonly<BrowserProjectOverviewPageResult>): number {
  return data.selectedEnvironmentName === null ? 6 : 5;
}

function readProjectOverviewServicesEmptyMessage(data: Readonly<BrowserProjectOverviewPageResult>): string {
  return data.selectedEnvironmentName === null ? 'No services found.' : 'No services found for this environment.';
}

function readProjectOverviewEnvironmentLabel(environmentName: string): string {
  return readBrowserConsoleEnvironmentLabel(environmentName, 'Environment');
}
