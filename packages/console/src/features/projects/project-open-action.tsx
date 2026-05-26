import type { JSX } from 'react';
import type { BrowserProjectOpenTarget, BrowserProjectSummary } from '../../services/browser-projects.service.types';
import { DropdownMenuItem } from '../../components/ui/dropdown-menu';

interface ProjectOpenActionProps {
  project: BrowserProjectSummary;
}

export function renderProjectOpenMenuItems({ project }: Readonly<ProjectOpenActionProps>): JSX.Element[] {
  if (project.status === 'archived') {
    return [];
  }

  const openTargets: BrowserProjectOpenTarget[] = buildProjectOpenTargets(project);
  if (openTargets.length === 0) {
    return [];
  }

  return renderProjectOpenItems(openTargets);
}

function buildProjectOpenTargets(project: BrowserProjectSummary): BrowserProjectOpenTarget[] {
  return [...project.openTargets];
}

function renderProjectOpenItems(openTargets: readonly BrowserProjectOpenTarget[]): JSX.Element[] {
  return openTargets.map(
    (target: BrowserProjectOpenTarget): JSX.Element => (
      <DropdownMenuItem asChild key={`open:${readProjectOpenTargetKey(target)}`}>
        <a href={target.routeUrl} rel="noreferrer" target="_blank">
          {readProjectOpenMenuItemLabel(target, openTargets)}
        </a>
      </DropdownMenuItem>
    ),
  );
}

function readProjectOpenMenuItemLabel(
  target: BrowserProjectOpenTarget,
  openTargets: readonly BrowserProjectOpenTarget[],
): string {
  if (openTargets.length === 1) {
    return 'Open';
  }

  return `Open ${readProjectOpenTargetLabel(target, openTargets)}`;
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
