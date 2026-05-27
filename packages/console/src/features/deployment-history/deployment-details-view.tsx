import type { JSX } from 'react';
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
} from '../../components/browser-console-header';
import { DismissibleAlert } from '../../components/dismissible-alert';
import { FileBox } from '../../components/ui/icons';
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
  onNavigate: BrowserSoftNavigateHandler;
  breadcrumbItems: BrowserBreadcrumbItem[];
  environmentName: string;
}

interface DeploymentDetailsPageProps extends DeploymentDetailsViewProps {
  organizationControl: JSX.Element | null;
}

interface DeploymentDetailsSectionsProps {
  data: BrowserDeploymentDetailsPageResult;
}

interface DeploymentDetailsPageTitleProps {
  environmentName: string;
}

export function DeploymentDetailsView({ data, onNavigate }: Readonly<DeploymentDetailsViewProps>): JSX.Element {
  const organizationControl: JSX.Element | null = readOrganizationControl(data, onNavigate);

  return <DeploymentDetailsPage data={data} onNavigate={onNavigate} organizationControl={organizationControl} />;
}

function DeploymentDetailsPage({
  data,
  onNavigate,
  organizationControl,
}: Readonly<DeploymentDetailsPageProps>): JSX.Element {
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
      <DeploymentDetailsContent data={data} onNavigate={onNavigate} />
    </BrowserConsoleShell>
  );
}

function DeploymentDetailsContent({ data, onNavigate }: Readonly<DeploymentDetailsViewProps>): JSX.Element {
  return (
    <div className={browserConsolePageClassName}>
      <DeploymentDetailsPageHeader
        breadcrumbItems={readDeploymentDetailsBreadcrumbItems(data)}
        environmentName={data.environmentName}
        onNavigate={onNavigate}
      />
      <section className={`${browserConsolePageBodyClassName} bg-background`}>
        <DismissibleAlert message={data.errorMessage} variant="error" />
        <DeploymentDetailsSections data={data} />
      </section>
    </div>
  );
}

function DeploymentDetailsSections({ data }: Readonly<DeploymentDetailsSectionsProps>): JSX.Element {
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
  breadcrumbItems,
  environmentName,
  onNavigate,
}: Readonly<DeploymentDetailsPageHeaderProps>): JSX.Element {
  return (
    <header className={browserConsoleDetailPageHeaderClassName}>
      <div className="pb-6">
        <BrowserBreadcrumbs items={breadcrumbItems} onNavigate={onNavigate} />
        <DeploymentDetailsPageTitle environmentName={environmentName} />
      </div>
    </header>
  );
}

function DeploymentDetailsPageTitle({ environmentName }: Readonly<DeploymentDetailsPageTitleProps>): JSX.Element {
  return (
    <BrowserConsoleDetailTitle
      badgeLabel={readDeploymentDetailsEnvironmentBadgeLabel(environmentName)}
      icon={FileBox}
      title="Deployment run details"
    />
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

function readDeploymentDetailsEnvironmentBadgeLabel(environmentName: string): string {
  return readBrowserConsoleEnvironmentLabel(environmentName, 'Environment');
}
