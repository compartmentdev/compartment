import type { JSX } from 'react';
import type { BrowserProjectOpenTarget, BrowserProjectSummary } from '../../services/browser-projects.service.types';
import {
  readServerTableActionControlClassName,
  readServerTableClosedBadgeClassName,
} from '../../components/server-table';
import { buttonVariants } from '../../components/ui/button';
import { ChevronDown } from '../../components/ui/icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { cn } from '../../lib/utils';
import { closedProjectRouteLabel } from './project-route-labels';

interface ProjectOpenActionProps {
  project: BrowserProjectSummary;
}

interface ProjectOpenLinkProps {
  children: string;
  className?: string | undefined;
  routeUrl: string;
}

interface ClosedRouteBadgeProps {
  label: string;
}

export function ProjectOpenAction({ project }: Readonly<ProjectOpenActionProps>): JSX.Element | null {
  if (project.status === 'archived') {
    return null;
  }

  const openTargets: BrowserProjectOpenTarget[] = buildProjectOpenTargets(project);
  if (openTargets.length === 0) {
    return project.lifecycleState === 'running' ? <ClosedRouteBadge label={closedProjectRouteLabel} /> : null;
  }

  return renderProjectOpenControl(project, openTargets);
}

function renderProjectOpenControl(
  project: BrowserProjectSummary,
  openTargets: readonly BrowserProjectOpenTarget[],
): JSX.Element {
  const primaryRouteUrl: string = readPrimaryProjectOpenRouteUrl(project, openTargets);

  if (openTargets.length === 1) {
    return <ProjectOpenLink routeUrl={primaryRouteUrl}>Open</ProjectOpenLink>;
  }

  return (
    <div className="inline-flex items-center">
      <ProjectOpenLink className="rounded-r-none border-r-0" routeUrl={primaryRouteUrl}>
        Open
      </ProjectOpenLink>
      <DropdownMenu>
        <DropdownMenuTrigger aria-label="Choose environment to open" className={readProjectOpenToggleClassName()}>
          <ChevronDown className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">{renderProjectOpenItems(openTargets)}</DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function readPrimaryProjectOpenRouteUrl(
  project: BrowserProjectSummary,
  openTargets: readonly BrowserProjectOpenTarget[],
): string {
  return project.routeUrl ?? openTargets[0]!.routeUrl;
}

function renderProjectOpenItems(openTargets: readonly BrowserProjectOpenTarget[]): JSX.Element[] {
  return openTargets.map(
    (target: BrowserProjectOpenTarget): JSX.Element => (
      <DropdownMenuItem asChild key={readProjectOpenTargetKey(target)}>
        <a href={target.routeUrl} rel="noreferrer" target="_blank">
          {readProjectOpenTargetLabel(target, openTargets)}
        </a>
      </DropdownMenuItem>
    ),
  );
}

function ProjectOpenLink({ children, className, routeUrl }: Readonly<ProjectOpenLinkProps>): JSX.Element {
  return (
    <a
      className={cn(
        buttonVariants({ size: 'sm', variant: 'secondary' }),
        readServerTableActionControlClassName(),
        className,
      )}
      href={routeUrl}
      rel="noreferrer"
      target="_blank"
    >
      {children}
    </a>
  );
}

function ClosedRouteBadge({ label }: Readonly<ClosedRouteBadgeProps>): JSX.Element {
  return <span className={readServerTableClosedBadgeClassName()}>{label}</span>;
}

function buildProjectOpenTargets(project: BrowserProjectSummary): BrowserProjectOpenTarget[] {
  return [...project.openTargets];
}

function readProjectOpenTargetLabel(
  target: BrowserProjectOpenTarget,
  openTargets: readonly BrowserProjectOpenTarget[],
): string {
  const environmentTargetCount: number = openTargets.filter(
    (candidate: BrowserProjectOpenTarget): boolean => candidate.environmentName === target.environmentName,
  ).length;

  return environmentTargetCount > 1 ? `${target.environmentName} / ${target.serviceName}` : target.environmentName;
}

function readProjectOpenTargetKey(target: BrowserProjectOpenTarget): string {
  return `${target.environmentName}:${target.serviceName}`;
}

function readProjectOpenToggleClassName(): string {
  return cn(
    buttonVariants({ size: 'sm', variant: 'secondary' }),
    readServerTableActionControlClassName(),
    'rounded-l-none border-l px-2',
  );
}
