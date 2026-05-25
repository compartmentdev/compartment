import { useState, type JSX } from 'react';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import { BrowserBreadcrumbs } from '../../components/browser-breadcrumbs';
import type { BrowserBreadcrumbItem } from '../../components/browser-breadcrumbs.types';
import { BrowserConsoleShell } from '../../components/browser-console-header';
import { DismissibleAlert } from '../../components/dismissible-alert';
import { ServerTableFrame } from '../../components/server-table';
import type { BrowserDeploymentHistoryPageResult } from '../../services/browser-deployment-history.service.types';
import type { BrowserConsoleOrganizationIssue } from '../../services/browser-organization-context.service.types';
import { BrowserConsoleOrganizationContextPanel } from '../console/console-organization-context-panel';
import { readBrowserConsoleOrganizationControl } from '../console/console-organization-control';
import { buildBrowserConsoleProjectsHref } from '../console/console-hrefs';
import type { DeploymentHistoryRollbackHandler } from './deployment-history-actions';
import { DeploymentHistoryTable } from './deployment-history-table';
import { createDeploymentHistoryRollbackHandler } from './deployment-history-view.actions';
import { buildProjectOverviewHref } from '../projects/project-overview-query';
import { buildDeploymentHistoryHref } from './deployment-history-query';

interface DeploymentHistoryViewProps {
  data: BrowserDeploymentHistoryPageResult;
  onNavigate: BrowserSoftNavigateHandler;
}

interface DeploymentHistoryHeaderProps {
  data: BrowserDeploymentHistoryPageResult;
  onNavigate: BrowserSoftNavigateHandler;
}

interface DeploymentHistoryContentProps {
  actionErrorMessage?: string | undefined;
  data: BrowserDeploymentHistoryPageResult;
  onNavigate: BrowserSoftNavigateHandler;
  onRollback: DeploymentHistoryRollbackHandler;
}

interface DeploymentHistoryShellProps {
  children: JSX.Element;
  data: BrowserDeploymentHistoryPageResult;
  onNavigate: BrowserSoftNavigateHandler;
  organizationControl: JSX.Element | null;
}

interface DeploymentHistoryOrganizationContextPanelProps {
  context: BrowserConsoleOrganizationIssue;
  data: BrowserDeploymentHistoryPageResult;
  onNavigate: BrowserSoftNavigateHandler;
}

export function DeploymentHistoryView({ data, onNavigate }: Readonly<DeploymentHistoryViewProps>): JSX.Element {
  const organizationControl: JSX.Element | null = readOrganizationControl(data, onNavigate);
  const [actionErrorMessage, setActionErrorMessage] = useState<string | undefined>(undefined);
  const onRollback: DeploymentHistoryRollbackHandler = createDeploymentHistoryRollbackHandler(
    data,
    onNavigate,
    setActionErrorMessage,
  );

  return (
    <DeploymentHistoryShell data={data} onNavigate={onNavigate} organizationControl={organizationControl}>
      <DeploymentHistoryContent
        actionErrorMessage={actionErrorMessage}
        data={data}
        onNavigate={onNavigate}
        onRollback={onRollback}
      />
    </DeploymentHistoryShell>
  );
}

function readOrganizationControl(
  data: BrowserDeploymentHistoryPageResult,
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

function DeploymentHistoryHeader({ data, onNavigate }: Readonly<DeploymentHistoryHeaderProps>): JSX.Element {
  return (
    <header className="flex flex-col gap-2">
      <BrowserBreadcrumbs items={readDeploymentHistoryBreadcrumbItems(data)} onNavigate={onNavigate} />
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold text-foreground">Deployments</h1>
        <p className="text-[13px] text-muted-foreground">{readScopeLabel(data)}</p>
      </div>
    </header>
  );
}

function readDeploymentHistoryBreadcrumbItems(
  data: Readonly<BrowserDeploymentHistoryPageResult>,
): BrowserBreadcrumbItem[] {
  return [
    {
      href: buildBrowserConsoleProjectsHref(data.selectedOrganizationSlug),
      label: 'Projects',
    },
    {
      href: buildProjectOverviewHref({
        environmentName: data.environmentName,
        organizationSlug: data.selectedOrganizationSlug,
        projectName: data.projectName,
      }),
      label: data.projectName,
    },
    {
      label: 'Deployments',
    },
  ];
}

function DeploymentHistoryContent({
  actionErrorMessage,
  data,
  onNavigate,
  onRollback,
}: Readonly<DeploymentHistoryContentProps>): JSX.Element {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5">
      <DismissibleAlert message={actionErrorMessage ?? data.errorMessage} variant="error" />
      {renderDeploymentHistoryContent(data, onNavigate, onRollback)}
    </div>
  );
}

function renderDeploymentHistoryContent(
  data: BrowserDeploymentHistoryPageResult,
  onNavigate: BrowserSoftNavigateHandler,
  onRollback: DeploymentHistoryRollbackHandler,
): JSX.Element {
  if (data.organizationContext.kind !== 'selected') {
    return (
      <DeploymentHistoryOrganizationContextPanel
        context={data.organizationContext}
        data={data}
        onNavigate={onNavigate}
      />
    );
  }

  return (
    <>
      <DeploymentHistoryHeader data={data} onNavigate={onNavigate} />
      <ServerTableFrame>
        <DeploymentHistoryTable data={data} onNavigate={onNavigate} onRollback={onRollback} />
      </ServerTableFrame>
    </>
  );
}

function DeploymentHistoryOrganizationContextPanel({
  context,
  data,
  onNavigate,
}: Readonly<DeploymentHistoryOrganizationContextPanelProps>): JSX.Element {
  return (
    <BrowserConsoleOrganizationContextPanel
      context={context}
      onNavigate={onNavigate}
      organizations={data.organizations}
      readOrganizationHref={(organizationSlug: string): string =>
        readDeploymentHistoryOrganizationHref(data, organizationSlug)
      }
    />
  );
}

function readDeploymentHistoryOrganizationHref(
  data: BrowserDeploymentHistoryPageResult,
  organizationSlug: string,
): string {
  return buildDeploymentHistoryHref({
    environmentName: data.environmentName,
    organizationSlug,
    projectName: data.projectName,
  });
}

function DeploymentHistoryShell({
  children,
  data,
  onNavigate,
  organizationControl,
}: Readonly<DeploymentHistoryShellProps>): JSX.Element {
  return (
    <BrowserConsoleShell
      currentOrganizationPermissions={data.currentOrganizationPermissions}
      organizationControl={organizationControl}
      onNavigate={onNavigate}
      page="projects"
      principalEmail={data.principalEmail}
      selectedOrganizationSlug={data.selectedOrganizationSlug}
    >
      {children}
    </BrowserConsoleShell>
  );
}

function handleOrganizationChange(
  data: BrowserDeploymentHistoryPageResult,
  onNavigate: BrowserSoftNavigateHandler,
  organizationSlug: string,
): void {
  onNavigate(
    buildDeploymentHistoryHref({
      environmentName: data.environmentName,
      organizationSlug,
      projectName: data.projectName,
    }),
  );
}

function readScopeLabel(data: BrowserDeploymentHistoryPageResult): string {
  return data.environmentName ?? 'environment required';
}
