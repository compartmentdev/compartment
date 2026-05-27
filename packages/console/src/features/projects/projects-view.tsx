import type { JSX } from 'react';
import { browserOnboardingPathname, browserProjectCreatePathname } from '../../browser-public-paths';
import {
  BrowserConsoleShell,
  browserConsolePageClassName,
  browserConsolePageHeaderClassName,
  browserConsoleListPageBodyClassName,
} from '../../components/browser-console-header';
import { DismissibleAlert } from '../../components/dismissible-alert';
import { ServerSearch } from '../../components/server-search';
import { ServerTableFrame } from '../../components/server-table';
import { ServerTableControls } from '../../components/server-table-controls';
import { ToolbarPrimaryActionLink } from '../../components/toolbar-primary-action';
import { Plus } from '../../components/ui/icons';
import { readBrowserTablePageSize } from '../../lib/server-table-query';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import type { BrowserProjectsPageResult } from '../../services/browser-projects.service.types';
import { AccessPageHeader } from '../access/access-ui';
import { BrowserConsoleOrganizationContextPanel } from '../console/console-organization-context-panel';
import { readBrowserConsoleOrganizationControl } from '../console/console-organization-control';
import { buildBrowserConsoleHref } from '../console/console-hrefs';
import type { ProjectActionHandler } from './project-actions';
import { ProjectArchiveStateSwitch } from './project-archive-state-switch';
import { ProjectsTable } from './projects-table';
import { buildProjectsHref } from './projects-query';

interface ProjectsViewProps {
  data: BrowserProjectsPageResult;
  onNavigate: BrowserSoftNavigateHandler;
  onProjectAction: ProjectActionHandler;
}

interface ProjectsToolbarProps {
  data: BrowserProjectsPageResult;
  onNavigate: BrowserSoftNavigateHandler;
}

interface ProjectsToolbarActionsProps {
  createProjectHref: string | null;
  onNavigate: BrowserSoftNavigateHandler;
}

interface ProjectsTableSectionProps {
  data: BrowserProjectsPageResult;
  onNavigate: BrowserSoftNavigateHandler;
  onProjectAction: ProjectActionHandler;
}

export function ProjectsView({ data, onNavigate, onProjectAction }: Readonly<ProjectsViewProps>): JSX.Element {
  const organizationControl: JSX.Element | null = readOrganizationControl(data, onNavigate);

  return (
    <BrowserConsoleShell
      currentOrganizationPermissions={data.currentOrganizationPermissions}
      organizationControl={organizationControl}
      onNavigate={onNavigate}
      page="projects"
      principalEmail={data.principalEmail}
      selectedOrganizationSlug={data.selectedOrganizationSlug}
    >
      <div className={browserConsolePageClassName}>
        {renderProjectsHeader(data, onNavigate)}
        <div className={browserConsoleListPageBodyClassName}>
          <DismissibleAlert message={data.errorMessage} variant="error" />
          <DismissibleAlert message={data.noticeMessage} variant="notice" />
          {renderProjectsContent(data, onNavigate, onProjectAction)}
        </div>
      </div>
    </BrowserConsoleShell>
  );
}

function renderProjectsHeader(data: BrowserProjectsPageResult, onNavigate: BrowserSoftNavigateHandler): JSX.Element {
  return (
    <header className={browserConsolePageHeaderClassName}>
      <ProjectsPageHeader
        action={<ProjectsToolbarActions createProjectHref={readCreateProjectHref(data)} onNavigate={onNavigate} />}
      />
    </header>
  );
}

function renderProjectsContent(
  data: BrowserProjectsPageResult,
  onNavigate: BrowserSoftNavigateHandler,
  onProjectAction: ProjectActionHandler,
): JSX.Element {
  if (data.organizationContext.kind !== 'selected') {
    return (
      <BrowserConsoleOrganizationContextPanel
        context={data.organizationContext}
        onNavigate={onNavigate}
        organizations={data.organizations}
        readOrganizationHref={(organizationSlug: string): string =>
          readOrganizationSelectionHref(data, organizationSlug)
        }
      />
    );
  }

  return (
    <>
      <ProjectsToolbar data={data} onNavigate={onNavigate} />
      <ProjectsTableSection data={data} onNavigate={onNavigate} onProjectAction={onProjectAction} />
    </>
  );
}

function readOrganizationControl(
  data: BrowserProjectsPageResult,
  onNavigate: BrowserSoftNavigateHandler,
): JSX.Element | null {
  return readBrowserConsoleOrganizationControl(
    data.organizations,
    data.selectedOrganizationSlug,
    data.showOrganizationSelector,
    (organizationSlug: string): void => {
      handleOrganizationChange(data, onNavigate, organizationSlug);
    },
  );
}

function ProjectsPageHeader({ action }: Readonly<{ action: JSX.Element }>): JSX.Element {
  return <AccessPageHeader action={action} title="Projects" />;
}

function ProjectsToolbar({ data, onNavigate }: Readonly<ProjectsToolbarProps>): JSX.Element {
  return (
    <header>
      <ServerSearch
        className="w-full max-w-none"
        hasLeadingSearchIcon
        label="Search projects"
        onSearch={(searchQuery: string): void => {
          handleSearchChange(data, onNavigate, searchQuery);
        }}
        placeholder="Search projects"
        value={data.searchQuery}
      />
    </header>
  );
}

function ProjectsToolbarActions({ createProjectHref, onNavigate }: Readonly<ProjectsToolbarActionsProps>): JSX.Element {
  return (
    <div className="flex flex-col gap-3 md:items-center">
      {createProjectHref === null ? null : (
        <ToolbarPrimaryActionLink href={createProjectHref} icon={Plus} onNavigate={onNavigate} variant="accent">
          Add project
        </ToolbarPrimaryActionLink>
      )}
    </div>
  );
}

function ProjectsTableSection({ data, onNavigate, onProjectAction }: Readonly<ProjectsTableSectionProps>): JSX.Element {
  return (
    <div className="flex flex-col">
      <ProjectArchiveStateSwitch data={data} onNavigate={onNavigate} />
      <ServerTableFrame className="flex min-h-[calc(100vh-288px)] flex-col">
        <div className="flex-1">
          <ProjectsTable data={data} onNavigate={onNavigate} onProjectAction={onProjectAction} />
        </div>
        {renderProjectsTableControls(data, onNavigate)}
      </ServerTableFrame>
    </div>
  );
}

function renderProjectsTableControls(
  data: BrowserProjectsPageResult,
  onNavigate: BrowserSoftNavigateHandler,
): JSX.Element {
  return (
    <ServerTableControls
      currentPage={data.page}
      itemLabel="project"
      nextPageHref={readNextPageHref(data)}
      onNavigate={onNavigate}
      onPageSizeChange={(value: string): void => {
        handlePageSizeChange(data, onNavigate, value);
      }}
      pageSize={String(data.pageSize)}
      pageSizeOptions={data.pageSizeOptions.map(String)}
      previousPageHref={readPreviousPageHref(data)}
      showPageSize={false}
      totalItems={data.totalProjects}
      totalPages={data.totalPages}
    />
  );
}

function handleSearchChange(
  data: BrowserProjectsPageResult,
  onNavigate: BrowserSoftNavigateHandler,
  searchQuery: string,
): void {
  onNavigate(buildProjectsHref(data, { page: 1, searchQuery }));
}

function handleOrganizationChange(
  data: BrowserProjectsPageResult,
  onNavigate: BrowserSoftNavigateHandler,
  organizationSlug: string,
): void {
  onNavigate(readOrganizationSelectionHref(data, organizationSlug));
}

function handlePageSizeChange(
  data: BrowserProjectsPageResult,
  onNavigate: BrowserSoftNavigateHandler,
  pageSize: string,
): void {
  onNavigate(buildProjectsHref(data, { page: 1, pageSize: readBrowserTablePageSize(pageSize) }));
}

function readPreviousPageHref(data: BrowserProjectsPageResult): string | null {
  return data.page > 1 ? buildProjectsHref(data, { page: data.page - 1 }) : null;
}

function readNextPageHref(data: BrowserProjectsPageResult): string | null {
  return data.page < data.totalPages ? buildProjectsHref(data, { page: data.page + 1 }) : null;
}

function readCreateProjectHref(data: BrowserProjectsPageResult): string | null {
  if (data.organizationContext.kind !== 'selected' || data.archiveState === 'archived' || data.projectCount === 0) {
    return null;
  }

  return buildBrowserConsoleHref(browserProjectCreatePathname, data.selectedOrganizationSlug);
}

function readOrganizationSelectionHref(data: BrowserProjectsPageResult, organizationSlug: string): string {
  return data.startOnboarding === true
    ? buildBrowserConsoleHref(browserOnboardingPathname, organizationSlug)
    : buildProjectsHref(data, { page: 1, selectedOrganizationSlug: organizationSlug });
}
