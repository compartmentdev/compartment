import type { JSX } from 'react';
import { BrowserBreadcrumbs } from '../../components/browser-breadcrumbs';
import type { BrowserBreadcrumbItem } from '../../components/browser-breadcrumbs.types';
import { BrowserSoftNavigationLink } from '../../components/browser-soft-navigation-link';
import { buttonVariants } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import type {
  BrowserProjectOverviewEnvironment,
  BrowserProjectOverviewPageResult,
} from '../../services/browser-project-overview.service.types';
import { buildBrowserConsoleProjectsHref } from '../console/console-hrefs';
import { buildDeploymentHistoryHref } from '../deployment-history/deployment-history-query';
import { readProjectNavigationTabClassName } from './project-navigation-tabs';
import { buildProjectOverviewHref } from './project-overview-query';

interface ProjectOverviewHeaderProps {
  data: BrowserProjectOverviewPageResult;
  onNavigate: BrowserSoftNavigateHandler;
}

interface ProjectOverviewEnvironmentSwitcherProps {
  data: BrowserProjectOverviewPageResult;
  onNavigate: BrowserSoftNavigateHandler;
}

interface ProjectOverviewEnvironmentButtonProps {
  environment: BrowserProjectOverviewEnvironment;
  onNavigate: BrowserSoftNavigateHandler;
  page: BrowserProjectOverviewPageResult;
}

export function ProjectOverviewHeader({ data, onNavigate }: Readonly<ProjectOverviewHeaderProps>): JSX.Element {
  return (
    <header className="flex flex-col gap-2">
      <BrowserBreadcrumbs items={readProjectOverviewBreadcrumbItems(data)} onNavigate={onNavigate} />
      <h1 className="text-lg font-semibold text-foreground">Project Overview</h1>
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

export function ProjectOverviewEnvironmentSwitcher({
  data,
  onNavigate,
}: Readonly<ProjectOverviewEnvironmentSwitcherProps>): JSX.Element | null {
  if (data.environments.length === 0) {
    return null;
  }

  return (
    <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <nav aria-label="Project environments" className="inline-flex flex-wrap items-center gap-5">
        {data.environments.map(
          (environment: BrowserProjectOverviewEnvironment): JSX.Element => (
            <ProjectOverviewEnvironmentButton
              environment={environment}
              key={environment.name}
              onNavigate={onNavigate}
              page={data}
            />
          ),
        )}
      </nav>
      {renderDeploymentsAction(data, onNavigate)}
    </section>
  );
}

function ProjectOverviewEnvironmentButton({
  environment,
  onNavigate,
  page,
}: Readonly<ProjectOverviewEnvironmentButtonProps>): JSX.Element {
  return (
    <BrowserSoftNavigationLink
      aria-current={environment.name === page.selectedEnvironmentName ? 'page' : undefined}
      className={readProjectNavigationTabClassName(environment.name === page.selectedEnvironmentName)}
      href={buildProjectOverviewHref({
        environmentName: environment.name,
        organizationSlug: page.selectedOrganizationSlug,
        projectName: page.projectName,
      })}
      onNavigate={onNavigate}
    >
      {environment.name}
    </BrowserSoftNavigationLink>
  );
}

function renderDeploymentsAction(
  data: BrowserProjectOverviewPageResult,
  onNavigate: BrowserSoftNavigateHandler,
): JSX.Element | null {
  if (data.selectedEnvironmentName === null || !data.canReadDeployments) {
    return null;
  }

  return (
    <div className="sm:ml-4">
      <BrowserSoftNavigationLink
        className={cn(buttonVariants({ size: 'sm', variant: 'outline' }), 'w-fit')}
        href={buildProjectDeploymentsHref(data)}
        onNavigate={onNavigate}
      >
        Project Deployments
      </BrowserSoftNavigationLink>
    </div>
  );
}

function buildProjectDeploymentsHref(data: BrowserProjectOverviewPageResult): string {
  return buildDeploymentHistoryHref({
    environmentName: data.selectedEnvironmentName,
    organizationSlug: data.selectedOrganizationSlug,
    projectName: data.projectName,
  });
}
