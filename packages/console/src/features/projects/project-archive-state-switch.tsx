import type { JSX } from 'react';
import type {
  BrowserProjectsPageResult,
  BrowserProjectsArchiveState,
} from '../../services/browser-projects.service.types';
import type { BrowserSoftNavigateHandler } from '../../browser-soft-navigation';
import { BrowserSoftNavigationLink } from '../../components/browser-soft-navigation-link';
import { buildProjectsHref } from './projects-query';
import { readProjectNavigationTabClassName } from './project-navigation-tabs';

interface ProjectArchiveStateSwitchProps {
  data: BrowserProjectsPageResult;
  onNavigate: BrowserSoftNavigateHandler;
}

interface ProjectArchiveStateLinkProps {
  active: boolean;
  data: BrowserProjectsPageResult;
  label: string;
  onNavigate: BrowserSoftNavigateHandler;
  value: BrowserProjectsArchiveState;
}

export function ProjectArchiveStateSwitch({
  data,
  onNavigate,
}: Readonly<ProjectArchiveStateSwitchProps>): JSX.Element | null {
  return renderProjectArchiveStateNavigation(data, onNavigate);
}

function renderProjectArchiveStateNavigation(
  data: BrowserProjectsPageResult,
  onNavigate: BrowserSoftNavigateHandler,
): JSX.Element {
  return (
    <nav aria-label="Project state" className="inline-flex shrink-0 items-center gap-5">
      <ProjectArchiveStateLink
        active={data.archiveState === 'active'}
        data={data}
        label="Active"
        onNavigate={onNavigate}
        value="active"
      />
      <ProjectArchiveStateLink
        active={data.archiveState === 'archived'}
        data={data}
        label="Archived"
        onNavigate={onNavigate}
        value="archived"
      />
    </nav>
  );
}

function ProjectArchiveStateLink({
  active,
  data,
  label,
  onNavigate,
  value,
}: Readonly<ProjectArchiveStateLinkProps>): JSX.Element {
  const href: string = buildProjectsHref(data, {
    archiveState: value,
    page: 1,
  });

  return (
    <BrowserSoftNavigationLink
      aria-current={active ? 'page' : undefined}
      className={readProjectNavigationTabClassName(active)}
      href={href}
      onNavigate={onNavigate}
    >
      {label}
    </BrowserSoftNavigationLink>
  );
}
