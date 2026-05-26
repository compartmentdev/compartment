import type { JSX } from 'react';
import { BrowserBreadcrumbs } from '../../components/browser-breadcrumbs';
import type { BrowserBreadcrumbItem } from '../../components/browser-breadcrumbs.types';
import {
  BrowserConsoleDetailTitle,
  readBrowserConsoleEnvironmentLabel,
} from '../../components/browser-console-detail-header';
import { browserConsoleDetailPageHeaderClassName } from '../../components/browser-console-header';
import { BrowserSoftNavigationLink } from '../../components/browser-soft-navigation-link';
import { buttonVariants } from '../../components/ui/button';
import {
  TabsLiftedNavigation,
  TabsLiftedTriggerContent,
  readTabsLiftedTriggerClassName,
} from '../../components/ui/tabs-lifted';
import { Boxes, ChevronRight } from '../../components/ui/icons';
import { cn } from '../../lib/utils';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import type {
  BrowserProjectOverviewEnvironment,
  BrowserProjectOverviewPageResult,
} from '../../services/browser-project-overview.service.types';
import { buildBrowserConsoleProjectsHref } from '../console/console-hrefs';
import { buildDeploymentHistoryHref } from '../deployment-history/deployment-history-query';
import { buildProjectOverviewHref } from './project-overview-query';

interface ProjectOverviewHeaderProps {
  data: BrowserProjectOverviewPageResult;
  onNavigate: BrowserSoftNavigateHandler;
}

interface ProjectOverviewDetailsHeaderProps {
  data: BrowserProjectOverviewPageResult;
  onNavigate: BrowserSoftNavigateHandler;
}

interface ProjectOverviewEnvironmentTabsProps {
  data: BrowserProjectOverviewPageResult;
  onNavigate: BrowserSoftNavigateHandler;
}

interface ProjectOverviewEnvironmentTabProps {
  active: boolean;
  environment: BrowserProjectOverviewEnvironment;
  onNavigate: BrowserSoftNavigateHandler;
  page: BrowserProjectOverviewPageResult;
}

export function ProjectOverviewHeader({ data, onNavigate }: Readonly<ProjectOverviewHeaderProps>): JSX.Element {
  return (
    <header className={browserConsoleDetailPageHeaderClassName}>
      <div className="pb-6">
        <BrowserBreadcrumbs items={readProjectOverviewBreadcrumbItems(data)} onNavigate={onNavigate} />
        <BrowserConsoleDetailTitle icon={Boxes} iconTone="purple" title="Overview" />
        <p className="mt-2 max-w-3xl text-[13px] leading-5 text-muted-foreground">
          Project services, routes, and deployment status by environment.
        </p>
      </div>
      <ProjectOverviewEnvironmentTabs data={data} onNavigate={onNavigate} />
    </header>
  );
}

export function ProjectOverviewDetailsHeader({
  data,
  onNavigate,
}: Readonly<ProjectOverviewDetailsHeaderProps>): JSX.Element {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h2 className="text-xl font-semibold leading-7 text-foreground">
        {readProjectOverviewEnvironmentLabel(data.selectedEnvironmentName)} details
      </h2>
      {renderDeploymentsAction(data, onNavigate)}
    </header>
  );
}

function readProjectOverviewBreadcrumbItems(data: Readonly<BrowserProjectOverviewPageResult>): BrowserBreadcrumbItem[] {
  return [
    {
      href: buildBrowserConsoleProjectsHref(data.selectedOrganizationSlug),
      label: 'Projects',
    },
    {
      label: data.project?.name ?? data.projectName,
    },
  ];
}

function ProjectOverviewEnvironmentTabs({
  data,
  onNavigate,
}: Readonly<ProjectOverviewEnvironmentTabsProps>): JSX.Element | null {
  if (data.environments.length === 0) {
    return null;
  }

  return (
    <TabsLiftedNavigation ariaLabel="Project environments" className="px-0">
      {data.environments.map(
        (environment: BrowserProjectOverviewEnvironment): JSX.Element => (
          <ProjectOverviewEnvironmentTab
            active={environment.name === data.selectedEnvironmentName}
            environment={environment}
            key={environment.name}
            onNavigate={onNavigate}
            page={data}
          />
        ),
      )}
    </TabsLiftedNavigation>
  );
}

function ProjectOverviewEnvironmentTab({
  active,
  environment,
  onNavigate,
  page,
}: Readonly<ProjectOverviewEnvironmentTabProps>): JSX.Element {
  const href: string = buildProjectOverviewEnvironmentHref(page, environment.name);

  return (
    <BrowserSoftNavigationLink
      aria-current={active ? 'page' : undefined}
      className={readProjectOverviewEnvironmentTabClassName(environment.name)}
      data-state={active ? 'active' : 'inactive'}
      href={href}
      onNavigate={onNavigate}
    >
      <TabsLiftedTriggerContent label={readProjectOverviewEnvironmentLabel(environment.name)} />
    </BrowserSoftNavigationLink>
  );
}

function buildProjectOverviewEnvironmentHref(
  page: Readonly<BrowserProjectOverviewPageResult>,
  environmentName: string,
): string {
  return buildProjectOverviewHref({
    environmentName,
    organizationSlug: page.selectedOrganizationSlug,
    projectName: page.projectName,
  });
}

function renderDeploymentsAction(
  data: BrowserProjectOverviewPageResult,
  onNavigate: BrowserSoftNavigateHandler,
): JSX.Element | null {
  if (data.selectedEnvironmentName === null || !data.canReadDeployments) {
    return null;
  }

  return (
    <BrowserSoftNavigationLink
      className={cn(buttonVariants({ variant: 'soft' }), 'h-9 w-fit rounded-lg px-3 no-underline')}
      href={buildProjectDeploymentsHref(data)}
      onNavigate={onNavigate}
    >
      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[12px] font-semibold leading-none text-primary-foreground">
        {readProjectOverviewDeploymentBadgeCount(data)}
      </span>
      <span>{readProjectOverviewEnvironmentLabel(data.selectedEnvironmentName)} Deployments</span>
      <ChevronRight aria-hidden="true" className="size-4" />
    </BrowserSoftNavigationLink>
  );
}

function buildProjectDeploymentsHref(data: BrowserProjectOverviewPageResult): string {
  return buildDeploymentHistoryHref({
    environmentName: data.selectedEnvironmentName,
    organizationSlug: data.selectedOrganizationSlug,
    projectName: data.projectName,
  });
}

function readProjectOverviewEnvironmentTabClassName(environmentName: string): string {
  return readTabsLiftedTriggerClassName(readProjectOverviewEnvironmentTabWidthClassName(environmentName));
}

function readProjectOverviewEnvironmentTabWidthClassName(environmentName: string): string {
  return readProjectOverviewEnvironmentLabel(environmentName).length > 7 ? 'w-[96px]' : 'w-[82px]';
}

function readProjectOverviewEnvironmentLabel(environmentName: string | null): string {
  return readBrowserConsoleEnvironmentLabel(environmentName, 'Project');
}

function readProjectOverviewDeploymentBadgeCount(data: Readonly<BrowserProjectOverviewPageResult>): number {
  return data.project?.serviceCount ?? data.services.length;
}
