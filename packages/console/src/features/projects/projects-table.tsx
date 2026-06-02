import type { JSX } from 'react';
import type {
  BrowserProjectSummary,
  BrowserProjectsPageResult,
  BrowserProjectsSortBy,
} from '../../services/browser-projects.service.types';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import { ServerTable, ServerTableHeading, ServerTableSortableHeading } from '../../components/server-table';
import type { ProjectActionHandler } from './project-actions';
import { buildProjectsHref, readNextSortDirection } from './projects-query';
import { ProjectTableRow } from './project-table-row';

interface ProjectsTableProps {
  data: BrowserProjectsPageResult;
  onNavigate: BrowserSoftNavigateHandler;
  onProjectAction: ProjectActionHandler;
}

interface SortableHeadingProps {
  data: BrowserProjectsPageResult;
  label: string;
  onNavigate: BrowserSoftNavigateHandler;
  sortBy: BrowserProjectsSortBy;
}

interface ProjectsEmptyRowProps {
  message: string;
}

export function ProjectsTable({ data, onNavigate, onProjectAction }: Readonly<ProjectsTableProps>): JSX.Element {
  return (
    <ServerTable minWidthClassName="min-w-[900px]">
      <thead className="bg-card">
        <tr>
          <SortableHeading data={data} label="Project" onNavigate={onNavigate} sortBy="project" />
          <SortableHeading data={data} label="Status" onNavigate={onNavigate} sortBy="status" />
          <SortableHeading data={data} label="Services" onNavigate={onNavigate} sortBy="services" />
          <SortableHeading data={data} label="Last deploy" onNavigate={onNavigate} sortBy="lastDeploy" />
          <SortableHeading data={data} label="Updated" onNavigate={onNavigate} sortBy="updated" />
          <ServerTableHeading align="right" label="Actions" />
        </tr>
      </thead>
      <tbody>{renderTableRows(data, onNavigate, onProjectAction)}</tbody>
    </ServerTable>
  );
}

function SortableHeading({ data, label, onNavigate, sortBy }: Readonly<SortableHeadingProps>): JSX.Element {
  const sortDirection: 'asc' | 'desc' | undefined = data.sortBy === sortBy ? data.sortDirection : undefined;

  return (
    <ServerTableSortableHeading
      href={buildProjectsHref(data, {
        page: 1,
        sortBy,
        sortDirection: readNextSortDirection(data, sortBy),
      })}
      label={label}
      onNavigate={onNavigate}
      sortDirection={sortDirection}
    />
  );
}

function renderTableRows(
  data: BrowserProjectsPageResult,
  onNavigate: BrowserSoftNavigateHandler,
  onProjectAction: ProjectActionHandler,
): JSX.Element[] {
  if (data.projects.length === 0) {
    return [<ProjectsEmptyRow key="empty" message="No projects found." />];
  }

  return data.projects.map(
    (project: BrowserProjectSummary): JSX.Element => (
      <ProjectTableRow
        data={data}
        key={project.name}
        onNavigate={onNavigate}
        onProjectAction={onProjectAction}
        project={project}
      />
    ),
  );
}

function ProjectsEmptyRow({ message }: Readonly<ProjectsEmptyRowProps>): JSX.Element {
  return (
    <tr>
      <td className="px-4 py-10 text-center" colSpan={6}>
        <div className="grid justify-items-center gap-3">
          <p className="text-[13px] text-muted-foreground">{message}</p>
        </div>
      </td>
    </tr>
  );
}
