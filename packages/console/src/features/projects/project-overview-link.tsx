import type { JSX } from 'react';
import type { BrowserProjectSummary, BrowserProjectsPageResult } from '../../services/browser-projects.service.types';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import { ServerTableActionLink } from '../../components/server-table';
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
    <ServerTableActionLink
      href={buildProjectOverviewHref({
        environmentName: null,
        organizationSlug: data.selectedOrganizationSlug,
        projectName: project.name,
      })}
      onNavigate={onNavigate}
    >
      Details
    </ServerTableActionLink>
  );
}
