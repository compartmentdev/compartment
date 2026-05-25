import type { JSX } from 'react';
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
}

export function ProjectOverviewServicesTable({ data }: Readonly<ProjectOverviewServicesTableProps>): JSX.Element {
  return (
    <ServerTableFrame>
      <ServerTable minWidthClassName="min-w-[760px]">
        <thead className="bg-background">
          <tr>
            <ServerTableHeading label="Service" />
            <ServerTableHeading label="Kind" />
            <ServerTableHeading label="Status" />
            <ServerTableHeading label="Route" />
            <ServerTableHeading label="Last deploy" />
          </tr>
        </thead>
        <tbody>{renderProjectOverviewServiceRows(data)}</tbody>
      </ServerTable>
    </ServerTableFrame>
  );
}

function renderProjectOverviewServiceRows(data: BrowserProjectOverviewPageResult): JSX.Element[] {
  if (data.services.length === 0) {
    return [<ServerTableEmptyRow colSpan={5} key="empty" message="No services found for this environment." />];
  }

  return data.services.map(
    (service: BrowserProjectOverviewService): JSX.Element => (
      <ProjectOverviewServiceRow key={service.name} service={service} />
    ),
  );
}

function ProjectOverviewServiceRow({ service }: Readonly<ProjectOverviewServiceRowProps>): JSX.Element {
  return (
    <ServerTableRow>
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

function renderProjectOverviewServiceName(name: string): JSX.Element {
  return <p className="text-[13px] font-medium text-foreground">{name}</p>;
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
