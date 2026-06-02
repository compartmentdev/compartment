import type { ChangeEvent, JSX } from 'react';
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
import { Select } from '../../components/select';
import { BrowserSoftNavigationLink } from '../../components/browser-soft-navigation-link';
import { buttonVariants } from '../../components/ui/button';
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

interface ProjectOverviewEnvironmentSelectProps {
  data: BrowserProjectOverviewPageResult;
  onNavigate: BrowserSoftNavigateHandler;
}

const projectOverviewAllEnvironmentsValue: string = '';

export function ProjectOverviewHeader({ data, onNavigate }: Readonly<ProjectOverviewHeaderProps>): JSX.Element {
  return (
    <header className={cn(browserConsoleDetailPageHeaderClassName, 'border-b-0 pb-0 pt-0')}>
      <div className={browserConsoleDetailBreadcrumbBarClassName}>
        <BrowserBreadcrumbs items={readProjectOverviewBreadcrumbItems(data)} onNavigate={onNavigate} />
      </div>
      <BrowserConsoleDetailTitle icon={Boxes} title="Overview" />
      <ProjectOverviewHeaderControls data={data} onNavigate={onNavigate} />
    </header>
  );
}

function ProjectOverviewHeaderControls({ data, onNavigate }: Readonly<ProjectOverviewHeaderProps>): JSX.Element {
  return (
    <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <ProjectOverviewEnvironmentSelect data={data} onNavigate={onNavigate} />
      {renderDeploymentsAction(data, onNavigate)}
    </div>
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

function ProjectOverviewEnvironmentSelect({
  data,
  onNavigate,
}: Readonly<ProjectOverviewEnvironmentSelectProps>): JSX.Element | null {
  if (data.environments.length === 0) {
    return null;
  }

  return (
    <label className="w-fit">
      <span className="sr-only">Project environment</span>
      <Select
        aria-label="Project environment"
        className="min-w-[10.5rem]"
        name="environmentName"
        onChange={(event: ChangeEvent<HTMLSelectElement>): void => {
          onNavigate(buildProjectOverviewEnvironmentHref(data, readProjectOverviewSelectEnvironmentName(event)));
        }}
        size="md"
        value={data.selectedEnvironmentName ?? projectOverviewAllEnvironmentsValue}
      >
        {renderProjectOverviewEnvironmentSelectOptions(data.environments)}
      </Select>
    </label>
  );
}

function buildProjectOverviewEnvironmentHref(
  page: Readonly<BrowserProjectOverviewPageResult>,
  environmentName: string | null,
): string {
  return buildProjectOverviewHref({
    environmentName,
    organizationSlug: page.selectedOrganizationSlug,
    projectName: page.projectName,
  });
}

function renderProjectOverviewEnvironmentSelectOptions(
  environments: BrowserProjectOverviewEnvironment[],
): JSX.Element[] {
  return [
    <option key="all-environments" value={projectOverviewAllEnvironmentsValue}>
      All
    </option>,
    ...environments.map(
      (environment: BrowserProjectOverviewEnvironment): JSX.Element => (
        <option key={environment.name} value={environment.name}>
          {readProjectOverviewEnvironmentLabel(environment.name)}
        </option>
      ),
    ),
  ];
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
      className={buttonVariants({ className: 'w-fit rounded-control px-3 no-underline', size: 'sm', variant: 'soft' })}
      href={buildProjectDeploymentsHref(data)}
      onNavigate={onNavigate}
    >
      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-pill bg-primary px-1.5 text-[12px] font-semibold leading-none text-primary-foreground">
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

function readProjectOverviewSelectEnvironmentName(event: ChangeEvent<HTMLSelectElement>): string | null {
  return event.target.value === projectOverviewAllEnvironmentsValue ? null : event.target.value;
}

function readProjectOverviewEnvironmentLabel(environmentName: string | null): string {
  return readBrowserConsoleEnvironmentLabel(environmentName, 'Project');
}

function readProjectOverviewDeploymentBadgeCount(data: Readonly<BrowserProjectOverviewPageResult>): number {
  return data.project?.serviceCount ?? data.services.length;
}
