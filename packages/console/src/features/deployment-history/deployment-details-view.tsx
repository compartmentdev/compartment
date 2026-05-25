import type { JSX } from 'react';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import { BrowserBreadcrumbs } from '../../components/browser-breadcrumbs';
import type { BrowserBreadcrumbItem } from '../../components/browser-breadcrumbs.types';
import { BrowserConsoleShell } from '../../components/browser-console-header';
import { BrowserSoftNavigationLink } from '../../components/browser-soft-navigation-link';
import { DismissibleAlert } from '../../components/dismissible-alert';
import { buttonVariants } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import type { BrowserDeploymentDetailsPageResult } from '../../services/browser-deployment-history.service.types';
import { buildBrowserConsoleProjectsHref } from '../console/console-hrefs';
import { readBrowserConsoleOrganizationControl } from '../console/console-organization-control';
import {
  DeploymentDetailsLogsSection,
  DeploymentDetailsServicesSection,
  DeploymentDetailsSummarySection,
  DeploymentDetailsTimelineSection,
} from './deployment-details-sections';
import { buildProjectOverviewHref } from '../projects/project-overview-query';
import { buildDeploymentHistoryHref } from './deployment-history-query';

interface DeploymentDetailsViewProps {
  data: BrowserDeploymentDetailsPageResult;
  onNavigate: BrowserSoftNavigateHandler;
}

interface DeploymentDetailsPageHeaderProps {
  backHref: string;
  onNavigate: BrowserSoftNavigateHandler;
  breadcrumbItems: BrowserBreadcrumbItem[];
  scopeLabel: string;
}

export function DeploymentDetailsView({ data, onNavigate }: Readonly<DeploymentDetailsViewProps>): JSX.Element {
  const organizationControl: JSX.Element | null = readOrganizationControl(data, onNavigate);

  return <DeploymentDetailsPage data={data} onNavigate={onNavigate} organizationControl={organizationControl} />;
}

function DeploymentDetailsPage({
  data,
  onNavigate,
  organizationControl,
}: Readonly<DeploymentDetailsViewProps & { organizationControl: JSX.Element | null }>): JSX.Element {
  return (
    <BrowserConsoleShell
      currentOrganizationPermissions={data.currentOrganizationPermissions}
      organizationControl={organizationControl}
      onNavigate={onNavigate}
      page="projects"
      principalEmail={data.principalEmail}
      selectedOrganizationSlug={data.selectedOrganizationSlug}
    >
      <DeploymentDetailsContent data={data} onNavigate={onNavigate} />
    </BrowserConsoleShell>
  );
}

function DeploymentDetailsContent({ data, onNavigate }: Readonly<DeploymentDetailsViewProps>): JSX.Element {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5">
      <DismissibleAlert message={data.errorMessage} variant="error" />
      <DeploymentDetailsPageHeader
        backHref={data.backHref}
        breadcrumbItems={readDeploymentDetailsBreadcrumbItems(data)}
        onNavigate={onNavigate}
        scopeLabel={data.environmentName}
      />
      <DeploymentDetailsSections data={data} />
    </div>
  );
}

function DeploymentDetailsSections({ data }: Readonly<{ data: BrowserDeploymentDetailsPageResult }>): JSX.Element {
  return (
    <>
      <DeploymentDetailsSummarySection deployment={data.deployment} />
      <DeploymentDetailsServicesSection deployments={data.deployments} />
      <DeploymentDetailsTimelineSection steps={data.steps} />
      <DeploymentDetailsLogsSection lines={data.lines} />
    </>
  );
}

function readOrganizationControl(
  data: BrowserDeploymentDetailsPageResult,
  onNavigate: BrowserSoftNavigateHandler,
): JSX.Element | null {
  return readBrowserConsoleOrganizationControl(
    data.organizations,
    data.selectedOrganizationSlug,
    data.showOrganizationSelector,
    (organizationSlug: string): void => {
      onNavigate(
        buildDeploymentHistoryHref({
          environmentName: data.environmentName,
          organizationSlug,
          projectName: data.projectName,
        }),
      );
    },
  );
}

function DeploymentDetailsPageHeader({
  backHref,
  breadcrumbItems,
  onNavigate,
  scopeLabel,
}: Readonly<DeploymentDetailsPageHeaderProps>): JSX.Element {
  return (
    <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="flex min-w-0 flex-col gap-2">
        <BrowserBreadcrumbs items={breadcrumbItems} onNavigate={onNavigate} />
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold text-foreground">Deployment run details</h1>
          <p className="text-[13px] text-muted-foreground">{scopeLabel}</p>
        </div>
      </div>
      <BrowserSoftNavigationLink
        className={cn(buttonVariants({ size: 'sm', variant: 'outline' }), 'w-fit')}
        href={backHref}
        onNavigate={onNavigate}
      >
        Deployments
      </BrowserSoftNavigationLink>
    </header>
  );
}

function readDeploymentDetailsBreadcrumbItems(
  data: Readonly<BrowserDeploymentDetailsPageResult>,
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
      href: data.backHref,
      label: 'Deployments',
    },
    {
      label: 'Run details',
    },
  ];
}
