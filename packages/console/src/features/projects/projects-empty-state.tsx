import type { JSX } from 'react';
import { browserProjectCreatePathname } from '../../browser-public-paths';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import { EmptyStateCard } from '../../components/empty-state-card';
import { projectsEmptyStateIconUrl } from '../../components/empty-state-icons';
import type { EmptyStateCardAction } from '../../components/empty-state-card.types';
import { Plus } from '../../components/ui/icons';
import type { BrowserProjectsPageResult } from '../../services/browser-projects.service.types';
import { buildBrowserConsoleHref } from '../console/console-hrefs';

interface ProjectsEmptyStateProps {
  data: BrowserProjectsPageResult;
  onNavigate: BrowserSoftNavigateHandler;
}

export function ProjectsEmptyState({ data, onNavigate }: Readonly<ProjectsEmptyStateProps>): JSX.Element {
  return (
    <EmptyStateCard
      action={readProjectsEmptyStateAction(data, onNavigate)}
      icon={projectsEmptyStateIconUrl}
      message="You do not have a project deployed in the Compartment."
    />
  );
}

export function shouldRenderProjectsEmptyState(data: BrowserProjectsPageResult): boolean {
  return data.archiveState === 'active' && data.projectCount === 0 && data.searchQuery.trim() === '';
}

function readProjectsEmptyStateAction(
  data: BrowserProjectsPageResult,
  onNavigate: BrowserSoftNavigateHandler,
): EmptyStateCardAction {
  return {
    href: buildBrowserConsoleHref(browserProjectCreatePathname, data.selectedOrganizationSlug),
    icon: Plus,
    kind: 'link',
    label: 'Add project',
    onNavigate,
  };
}
