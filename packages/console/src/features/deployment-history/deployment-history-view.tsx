import { useState, type JSX } from 'react';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import {
  BrowserConsoleShell,
  browserConsolePageBodyClassName,
  browserConsolePageClassName,
  browserConsolePageGutterClassName,
} from '../../components/browser-console-header';
import { DismissibleAlert } from '../../components/dismissible-alert';
import { ServerTableFrame } from '../../components/server-table';
import type { BrowserDeploymentHistoryPageResult } from '../../services/browser-deployment-history.service.types';
import type { BrowserConsoleOrganizationIssue } from '../../services/browser-organization-context.service.types';
import { BrowserConsoleOrganizationContextPanel } from '../console/console-organization-context-panel';
import { readBrowserConsoleOrganizationControl } from '../console/console-organization-control';
import type { DeploymentHistoryRollbackHandler } from './deployment-history-actions';
import { DeploymentHistoryControls, DeploymentHistoryHeader } from './deployment-history-sections';
import { DeploymentHistoryTable } from './deployment-history-table';
import { createDeploymentHistoryRollbackHandler } from './deployment-history-view.actions';
import { buildDeploymentHistoryHref } from './deployment-history-query';

interface DeploymentHistoryViewProps {
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
      <section className={`flex flex-1 flex-col gap-6 bg-background pb-8 pt-4 ${browserConsolePageGutterClassName}`}>
        <DismissibleAlert message={errorMessage} variant="error" />
        <ServerTableFrame className="flex min-h-[calc(100vh-300px)] flex-1 flex-col">
          <div className="flex-1">
            <DeploymentHistoryTable data={data} onNavigate={onNavigate} onRollback={onRollback} />
          </div>
          <DeploymentHistoryControls totalDeployments={data.deployments.length} />
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
