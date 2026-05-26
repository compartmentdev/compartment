import type { JSX } from 'react';
import type { BrowserProjectSummary, BrowserProjectsPageResult } from '../../services/browser-projects.service.types';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import { BrowserSoftNavigationLink } from '../../components/browser-soft-navigation-link';
import { readServerTableActionControlClassName } from '../../components/server-table';
import { buttonVariants } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import { buildProjectOverviewHref } from './project-overview-query';

interface ProjectOverviewLinkProps {
  data: BrowserProjectsPageResult;
  onNavigate: BrowserSoftNavigateHandler;
  project: BrowserProjectSummary;
}

export function ProjectOverviewLink({
  data,
  onNavigate,
  project,
}: Readonly<ProjectOverviewLinkProps>): JSX.Element | null {
  if (data.selectedOrganizationSlug === null) {
    return null;
  }

  return (
    <BrowserSoftNavigationLink
      className={cn(buttonVariants({ size: 'sm', variant: 'secondary' }), readServerTableActionControlClassName())}
      href={buildProjectOverviewHref({
        environmentName: null,
        organizationSlug: data.selectedOrganizationSlug,
        projectName: project.name,
      })}
      onNavigate={onNavigate}
    >
      Details
    </BrowserSoftNavigationLink>
  );
}
