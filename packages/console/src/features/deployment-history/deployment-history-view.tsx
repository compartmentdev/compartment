import { useState, type JSX } from 'react';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import { BrowserBreadcrumbs } from '../../components/browser-breadcrumbs';
import type { BrowserBreadcrumbItem } from '../../components/browser-breadcrumbs.types';
import {
  BrowserConsoleDetailTitle,
  readBrowserConsoleEnvironmentLabel,
} from '../../components/browser-console-detail-header';
import {
  BrowserConsoleShell,
  browserConsoleDetailPageHeaderClassName,
  browserConsolePageBodyClassName,
  browserConsolePageClassName,
  browserConsolePageGutterClassName,
} from '../../components/browser-console-header';
import { DismissibleAlert } from '../../components/dismissible-alert';
import { ServerTableFrame } from '../../components/server-table';
import { Box } from '../../components/ui/icons';
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
    <header className={browserConsoleDetailPageHeaderClassName}>
      <div className="pb-6">
        <BrowserBreadcrumbs items={readDeploymentHistoryBreadcrumbItems(data)} onNavigate={onNavigate} />
        <BrowserConsoleDetailTitle
          badgeLabel={readDeploymentHistoryEnvironmentBadgeLabel(data)}
          icon={Box}
          title="Deployments"
        />
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
  return renderDeploymentHistoryContent(actionErrorMessage ?? data.errorMessage, data, onNavigate, onRollback);
}

function renderDeploymentHistoryContent(
  errorMessage: string | undefined,
  data: BrowserDeploymentHistoryPageResult,
  onNavigate: BrowserSoftNavigateHandler,
  onRollback: DeploymentHistoryRollbackHandler,
): JSX.Element {
  if (data.organizationContext.kind !== 'selected') {
    return renderDeploymentHistoryOrganizationContext(errorMessage, data.organizationContext, data, onNavigate);
  }

  return renderSelectedDeploymentHistoryContent(errorMessage, data, onNavigate, onRollback);
}

function renderDeploymentHistoryOrganizationContext(
  errorMessage: string | undefined,
  context: BrowserConsoleOrganizationIssue,
  data: BrowserDeploymentHistoryPageResult,
  onNavigate: BrowserSoftNavigateHandler,
): JSX.Element {
  return (
    <div className={browserConsolePageBodyClassName}>
      <DismissibleAlert message={errorMessage} variant="error" />
      <DeploymentHistoryOrganizationContextPanel context={context} data={data} onNavigate={onNavigate} />
    </div>
  );
}

function renderSelectedDeploymentHistoryContent(
  errorMessage: string | undefined,
  data: BrowserDeploymentHistoryPageResult,
  onNavigate: BrowserSoftNavigateHandler,
  onRollback: DeploymentHistoryRollbackHandler,
): JSX.Element {
  return (
    <div className={browserConsolePageClassName}>
      <DeploymentHistoryHeader data={data} onNavigate={onNavigate} />
      <section className={`flex flex-1 flex-col gap-5 bg-background py-8 ${browserConsolePageGutterClassName}`}>
        <DismissibleAlert message={errorMessage} variant="error" />
        <ServerTableFrame className="flex flex-1 flex-col">
          <DeploymentHistoryTable data={data} onNavigate={onNavigate} onRollback={onRollback} />
        </ServerTableFrame>
      </section>
    </div>
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
      projectCount={data.projectCount}
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

function readDeploymentHistoryEnvironmentBadgeLabel(data: BrowserDeploymentHistoryPageResult): string {
  return readBrowserConsoleEnvironmentLabel(data.environmentName, 'Environment');
}
