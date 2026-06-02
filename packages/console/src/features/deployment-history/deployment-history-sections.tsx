import type { JSX } from 'react';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import { BrowserBreadcrumbs } from '../../components/browser-breadcrumbs';
import type { BrowserBreadcrumbItem } from '../../components/browser-breadcrumbs.types';
import {
  BrowserConsoleDetailTitle,
  readBrowserConsoleEnvironmentLabel,
} from '../../components/browser-console-detail-header';
import {
  browserConsoleDetailBreadcrumbBarClassName,
  browserConsoleDetailPageHeaderClassName,
} from '../../components/browser-console-header';
import { ServerTableControls } from '../../components/server-table-controls';
import { Box } from '../../components/ui/icons';
import { cn } from '../../lib/utils';
import type { BrowserDeploymentHistoryPageResult } from '../../services/browser-deployment-history.service.types';
import { buildBrowserConsoleProjectsHref } from '../console/console-hrefs';
import { buildProjectOverviewHref } from '../projects/project-overview-query';

interface DeploymentHistoryHeaderProps {
  data: BrowserDeploymentHistoryPageResult;
  onNavigate: BrowserSoftNavigateHandler;
}

interface DeploymentHistoryControlsProps {
  totalDeployments: number;
}

export function DeploymentHistoryHeader({ data, onNavigate }: Readonly<DeploymentHistoryHeaderProps>): JSX.Element {
  return (
    <header className={cn(browserConsoleDetailPageHeaderClassName, 'border-b-0 pb-0 pt-0')}>
      <div className={browserConsoleDetailBreadcrumbBarClassName}>
        <BrowserBreadcrumbs items={readDeploymentHistoryBreadcrumbItems(data)} onNavigate={onNavigate} />
      </div>
      <BrowserConsoleDetailTitle
        badgeLabel={readDeploymentHistoryEnvironmentBadgeLabel(data.environmentName)}
        icon={Box}
        title="Deployments"
      />
    </header>
  );
}

export function DeploymentHistoryControls({ totalDeployments }: Readonly<DeploymentHistoryControlsProps>): JSX.Element {
  return (
    <ServerTableControls
      currentPage={1}
      itemLabel="deployment"
      nextPageHref={null}
      onPageSizeChange={ignoreDeploymentHistoryPageSizeChange}
      pageSize={String(totalDeployments)}
      pageSizeOptions={[]}
      previousPageHref={null}
      showPageSize={false}
      totalItems={totalDeployments}
      totalPages={1}
    />
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

function ignoreDeploymentHistoryPageSizeChange(): void {
  return;
}

function readDeploymentHistoryEnvironmentBadgeLabel(environmentName: string | null): string | undefined {
  return environmentName === null ? undefined : readDeploymentHistoryEnvironmentLabel(environmentName);
}

function readDeploymentHistoryEnvironmentLabel(environmentName: string | null): string {
  return readBrowserConsoleEnvironmentLabel(environmentName, 'Environment');
}
