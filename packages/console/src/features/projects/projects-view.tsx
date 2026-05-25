import type { JSX } from 'react';
import { browserOnboardingPathname, browserProjectCreatePathname } from '../../browser-public-paths';
import { BrowserConsoleShell } from '../../components/browser-console-header';
import { DismissibleAlert } from '../../components/dismissible-alert';
import { ServerSearch } from '../../components/server-search';
import { ServerTableFrame } from '../../components/server-table';
import { ServerTableControls } from '../../components/server-table-controls';
import { ToolbarPrimaryActionLink } from '../../components/toolbar-primary-action';
import { FolderPlus } from '../../components/ui/icons';
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
  createProjectHref: string | null;
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
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5">
        <DismissibleAlert message={data.errorMessage} variant="error" />
        <DismissibleAlert message={data.noticeMessage} variant="notice" />
        {renderProjectsContent(data, onNavigate, onProjectAction)}
      </div>
    </BrowserConsoleShell>
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
      <ProjectsPageHeader />
      <ProjectsToolbar createProjectHref={readCreateProjectHref(data)} data={data} onNavigate={onNavigate} />
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

function ProjectsPageHeader(): JSX.Element {
  return <AccessPageHeader title="Projects" />;
}

function ProjectsToolbar({ createProjectHref, data, onNavigate }: Readonly<ProjectsToolbarProps>): JSX.Element {
  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-3 md:min-w-0 md:flex-1 md:flex-row md:items-center md:gap-4">
          <ServerSearch
            label="Search projects"
            onSearch={(searchQuery: string): void => {
              handleSearchChange(data, onNavigate, searchQuery);
            }}
            placeholder="Search projects"
            value={data.searchQuery}
          />
          <ProjectArchiveStateSwitch data={data} onNavigate={onNavigate} />
        </div>
        <ProjectsToolbarActions createProjectHref={createProjectHref} onNavigate={onNavigate} />
      </div>
    </header>
  );
}

function ProjectsToolbarActions({ createProjectHref, onNavigate }: Readonly<ProjectsToolbarActionsProps>): JSX.Element {
  return (
    <div className="flex flex-col gap-3 md:items-center">
      {createProjectHref === null ? null : (
        <ToolbarPrimaryActionLink href={createProjectHref} icon={FolderPlus} onNavigate={onNavigate}>
          Add project
        </ToolbarPrimaryActionLink>
      )}
    </div>
  );
}

function ProjectsTableSection({ data, onNavigate, onProjectAction }: Readonly<ProjectsTableSectionProps>): JSX.Element {
  return (
    <ServerTableFrame>
      <ProjectsTable data={data} onNavigate={onNavigate} onProjectAction={onProjectAction} />
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
        totalItems={data.totalProjects}
        totalPages={data.totalPages}
      />
    </ServerTableFrame>
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
  if (data.organizationContext.kind !== 'selected' || data.archiveState !== 'active' || data.projectCount === 0) {
    return null;
  }

  return buildBrowserConsoleHref(browserProjectCreatePathname, data.selectedOrganizationSlug);
}

function readOrganizationSelectionHref(data: BrowserProjectsPageResult, organizationSlug: string): string {
  return data.startOnboarding === true
    ? buildBrowserConsoleHref(browserOnboardingPathname, organizationSlug)
    : buildProjectsHref(data, { page: 1, selectedOrganizationSlug: organizationSlug });
}
