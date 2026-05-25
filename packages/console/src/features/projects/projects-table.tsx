import type { JSX } from 'react';
import { browserProjectCreatePathname } from '../../browser-public-paths';
import { BrowserSoftNavigationLink } from '../../components/browser-soft-navigation-link';
import { buttonVariants } from '../../components/ui/button';
import { buildBrowserConsoleHref } from '../console/console-hrefs';
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
  data: BrowserProjectsPageResult;
  onNavigate: BrowserSoftNavigateHandler;
}

export function ProjectsTable({ data, onNavigate, onProjectAction }: Readonly<ProjectsTableProps>): JSX.Element {
  return (
    <ServerTable minWidthClassName="min-w-[900px]">
      <thead className="bg-background">
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
    return [<ProjectsEmptyRow data={data} key="empty" onNavigate={onNavigate} />];
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

function ProjectsEmptyRow({ data, onNavigate }: Readonly<ProjectsEmptyRowProps>): JSX.Element {
  const onboardingLink: JSX.Element | null =
    data.archiveState === 'active' && data.projectCount === 0 ? (
      <BrowserSoftNavigationLink
        className={buttonVariants({ variant: 'default' })}
        href={buildBrowserConsoleHref(browserProjectCreatePathname, data.selectedOrganizationSlug)}
        onNavigate={onNavigate}
      >
        Deploy my first project
      </BrowserSoftNavigationLink>
    ) : null;

  return (
    <tr>
      <td className="px-4 py-10 text-center" colSpan={6}>
        <div className="grid justify-items-center gap-3">
          <p className="text-[13px] text-muted-foreground">No projects found.</p>
          {onboardingLink}
        </div>
      </td>
    </tr>
  );
}
