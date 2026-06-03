import type { JSX } from 'react';
import {
  BrowserConsoleShell,
  browserConsolePageBodyClassName,
  browserConsolePageClassName,
  browserConsolePageGutterClassName,
} from '../../components/browser-console-header';
import { DismissibleAlert } from '../../components/dismissible-alert';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import type { BrowserProjectOverviewPageResult } from '../../services/browser-project-overview.service.types';
import type { BrowserConsoleOrganizationIssue } from '../../services/browser-organization-context.service.types';
import { BrowserConsoleOrganizationContextPanel } from '../console/console-organization-context-panel';
import { readBrowserConsoleOrganizationControl } from '../console/console-organization-control';
import { ProjectOverviewHeader } from './project-overview-sections';
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
      projectCount={data.projectCount}
      selectedOrganizationSlug={data.selectedOrganizationSlug}
    >
      {renderProjectOverviewContent(data, onNavigate)}
    </BrowserConsoleShell>
  );
}

function renderProjectOverviewContent(
  data: BrowserProjectOverviewPageResult,
  onNavigate: BrowserSoftNavigateHandler,
): JSX.Element {
  if (data.organizationContext.kind !== 'selected') {
    return renderProjectOverviewOrganizationContext(data.organizationContext, data, onNavigate);
  }

  return renderSelectedProjectOverviewContent(data, onNavigate);
}

function renderProjectOverviewOrganizationContext(
  context: BrowserConsoleOrganizationIssue,
  data: BrowserProjectOverviewPageResult,
  onNavigate: BrowserSoftNavigateHandler,
): JSX.Element {
  return (
    <div className={browserConsolePageBodyClassName}>
      <DismissibleAlert message={data.errorMessage} variant="error" />
      <ProjectOverviewOrganizationContextPanel context={context} data={data} onNavigate={onNavigate} />
    </div>
  );
}

function renderSelectedProjectOverviewContent(
  data: BrowserProjectOverviewPageResult,
  onNavigate: BrowserSoftNavigateHandler,
): JSX.Element {
  return (
    <div className={browserConsolePageClassName}>
      <ProjectOverviewHeader data={data} onNavigate={onNavigate} />
      <section className={`flex flex-1 flex-col gap-6 bg-background pb-8 pt-4 ${browserConsolePageGutterClassName}`}>
        <DismissibleAlert message={data.errorMessage} variant="error" />
        <ProjectOverviewServicesTable data={data} />
      </section>
    </div>
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
