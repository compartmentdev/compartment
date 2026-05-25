import type { JSX } from 'react';
import { BrowserConsoleShell } from '../../components/browser-console-header';
import { DismissibleAlert } from '../../components/dismissible-alert';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import type { BrowserProjectOverviewPageResult } from '../../services/browser-project-overview.service.types';
import type { BrowserConsoleOrganizationIssue } from '../../services/browser-organization-context.service.types';
import { BrowserConsoleOrganizationContextPanel } from '../console/console-organization-context-panel';
import { readBrowserConsoleOrganizationControl } from '../console/console-organization-control';
import { ProjectOverviewEnvironmentSwitcher, ProjectOverviewHeader } from './project-overview-sections';
import { ProjectOverviewServicesTable } from './project-overview-services-table';
import { buildProjectOverviewHref } from './project-overview-query';

interface ProjectOverviewViewProps {
  data: BrowserProjectOverviewPageResult;
  onNavigate: BrowserSoftNavigateHandler;
}

interface ProjectOverviewOrganizationContextPanelProps {
  context: BrowserConsoleOrganizationIssue;
  data: BrowserProjectOverviewPageResult;
  onNavigate: BrowserSoftNavigateHandler;
}

export function ProjectOverviewView({ data, onNavigate }: Readonly<ProjectOverviewViewProps>): JSX.Element {
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
        {renderProjectOverviewContent(data, onNavigate)}
      </div>
    </BrowserConsoleShell>
  );
}

function renderProjectOverviewContent(
  data: BrowserProjectOverviewPageResult,
  onNavigate: BrowserSoftNavigateHandler,
): JSX.Element {
  if (data.organizationContext.kind !== 'selected') {
    return (
      <ProjectOverviewOrganizationContextPanel context={data.organizationContext} data={data} onNavigate={onNavigate} />
    );
  }

  return (
    <>
      <ProjectOverviewHeader data={data} onNavigate={onNavigate} />
      <ProjectOverviewEnvironmentSwitcher data={data} onNavigate={onNavigate} />
      <ProjectOverviewServicesTable data={data} />
    </>
  );
}

function ProjectOverviewOrganizationContextPanel({
  context,
  data,
  onNavigate,
}: Readonly<ProjectOverviewOrganizationContextPanelProps>): JSX.Element {
  return (
    <BrowserConsoleOrganizationContextPanel
      context={context}
      onNavigate={onNavigate}
      organizations={data.organizations}
      readOrganizationHref={(organizationSlug: string): string =>
        buildProjectOverviewHref({
          environmentName: data.selectedEnvironmentName,
          organizationSlug,
          projectName: data.projectName,
        })
      }
    />
  );
}

function readOrganizationControl(
  data: BrowserProjectOverviewPageResult,
  onNavigate: BrowserSoftNavigateHandler,
): JSX.Element | null {
  return readBrowserConsoleOrganizationControl(
    data.organizations,
    data.selectedOrganizationSlug,
    data.showOrganizationSelector,
    (organizationSlug: string): void => {
      onNavigate(
        buildProjectOverviewHref({
          environmentName: data.selectedEnvironmentName,
          organizationSlug,
          projectName: data.projectName,
        }),
      );
    },
  );
}
