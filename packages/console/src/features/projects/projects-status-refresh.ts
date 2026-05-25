import {
  projectStatusListResponseSchema,
  type ProjectStatusListResponse,
  type ProjectStatusSummary,
} from '@compartment/contracts/browser';
import { projectsApiPathname } from '../../routes/projects/projects-api-paths';
import type {
  BrowserProjectsArchiveState,
  BrowserProjectStatus,
  BrowserProjectSummary,
  BrowserProjectsPageResult,
  BrowserProjectsSortBy,
  BrowserProjectsSortDirection,
} from '../../services/browser-projects.service.types';
import { requestBrowserApi } from '../../lib/browser-api';
import { readBrowserApiRedirect, type BrowserRedirect } from '../../lib/browser-redirect';
import { areBrowserProjectOpenTargetsEqual, toBrowserProjectOpenTargets } from './project-open-targets';

interface MergedProjectStatuses {
  projects: BrowserProjectSummary[];
  removedProjectCount: number;
  statusChanged: boolean;
}

interface MergedProjectEntry {
  changed: boolean;
  project: BrowserProjectSummary | null;
}

export async function refreshProjectStatuses(
  currentData: BrowserProjectsPageResult,
): Promise<BrowserProjectsPageResult> {
  if (currentData.selectedOrganizationSlug === null || currentData.projects.length === 0) {
    return currentData;
  }

  try {
    const response: ProjectStatusListResponse = await requestBrowserApi<ProjectStatusListResponse>(
      buildProjectStatusListPath(currentData.projects),
      projectStatusListResponseSchema,
      {
        currentOrganization: currentData.selectedOrganizationSlug,
      },
    );

    return mergeProjectStatuses(currentData, response.projects);
  } catch (error) {
    if (error instanceof Error) {
      const apiRedirect: BrowserRedirect | null = readBrowserApiRedirect(error);
      if (apiRedirect !== null) {
        throw apiRedirect;
      }
    }

    throw error;
  }
}

function buildProjectStatusListPath(projects: BrowserProjectSummary[]): string {
  const searchParams: URLSearchParams = new URLSearchParams();
  searchParams.set('detail', 'status');
  for (const project of projects) {
    searchParams.append('projectIds', project.id);
  }

  return `${projectsApiPathname}?${searchParams.toString()}`;
}

function mergeProjectStatuses(
  currentData: BrowserProjectsPageResult,
  refreshedProjects: ProjectStatusSummary[],
): BrowserProjectsPageResult {
  const refreshedProjectsById: Map<string, ProjectStatusSummary> = new Map<string, ProjectStatusSummary>(
    refreshedProjects.map((project: ProjectStatusSummary): [string, ProjectStatusSummary] => [project.id, project]),
  );
  const mergeResult: MergedProjectStatuses = mergeRefreshedProjects(currentData, refreshedProjectsById);

  if (!mergeResult.statusChanged) {
    return currentData;
  }

  return {
    ...currentData,
    projects: sortProjectsAfterStatusRefresh(mergeResult.projects, currentData.sortBy, currentData.sortDirection),
    ...readUpdatedPagination(currentData, mergeResult.removedProjectCount),
  };
}

function mergeRefreshedProjects(
  currentData: BrowserProjectsPageResult,
  refreshedProjectsById: Map<string, ProjectStatusSummary>,
): MergedProjectStatuses {
  const projects: BrowserProjectSummary[] = [];
  let removedProjectCount: number = 0;
  let statusChanged: boolean = false;

  for (const project of currentData.projects) {
    const mergedProject: MergedProjectEntry = mergeProjectEntry(
      project,
      currentData.archiveState,
      refreshedProjectsById.get(project.id),
    );
    if (mergedProject.project === null) {
      removedProjectCount += 1;
      statusChanged = true;
      continue;
    }

    projects.push(mergedProject.project);
    statusChanged ||= mergedProject.changed;
  }

  return { projects, removedProjectCount, statusChanged };
}

function mergeProjectEntry(
  project: BrowserProjectSummary,
  archiveState: BrowserProjectsArchiveState,
  refreshedProject: ProjectStatusSummary | undefined,
): MergedProjectEntry {
  if (shouldDropProjectFromCurrentView(archiveState, refreshedProject)) {
    return {
      changed: true,
      project: null,
    };
  }

  const mergedProject: BrowserProjectSummary = mergeProjectStatus(project, refreshedProject);
  return {
    changed: mergedProject !== project,
    project: mergedProject,
  };
}

function shouldDropProjectFromCurrentView(
  archiveState: BrowserProjectsArchiveState,
  refreshedProject: ProjectStatusSummary | undefined,
): boolean {
  return archiveState === 'active' && (refreshedProject === undefined || refreshedProject.status === 'archived');
}

function mergeProjectStatus(
  project: BrowserProjectSummary,
  refreshedProject: ProjectStatusSummary | undefined,
): BrowserProjectSummary {
  if (refreshedProject === undefined) {
    return project;
  }

  if (!hasProjectStatusChanged(project, refreshedProject)) {
    return project;
  }

  return {
    ...project,
    lifecycleAction: refreshedProject.lifecycleAction,
    lifecycleDisabledReason: refreshedProject.lifecycleDisabledReason,
    lifecycleState: refreshedProject.lifecycleState,
    openTargets: toBrowserProjectOpenTargets(refreshedProject.openTargets),
    routeUrl: refreshedProject.routeUrl,
    status: refreshedProject.status,
  };
}

function hasProjectStatusChanged(project: BrowserProjectSummary, refreshedProject: ProjectStatusSummary): boolean {
  return (
    project.lifecycleAction !== refreshedProject.lifecycleAction ||
    project.lifecycleDisabledReason !== refreshedProject.lifecycleDisabledReason ||
    project.lifecycleState !== refreshedProject.lifecycleState ||
    !areBrowserProjectOpenTargetsEqual(project.openTargets, refreshedProject.openTargets) ||
    project.routeUrl !== refreshedProject.routeUrl ||
    project.status !== refreshedProject.status
  );
}

function sortProjectsAfterStatusRefresh(
  projects: BrowserProjectSummary[],
  sortBy: BrowserProjectsSortBy,
  sortDirection: BrowserProjectsSortDirection,
): BrowserProjectSummary[] {
  if (sortBy !== 'status') {
    return projects;
  }

  const direction: number = sortDirection === 'asc' ? 1 : -1;
  return [...projects].sort((left: BrowserProjectSummary, right: BrowserProjectSummary): number => {
    const comparison: number = readProjectStatusRank(left.status) - readProjectStatusRank(right.status);
    if (comparison !== 0) {
      return comparison * direction;
    }

    return left.name.localeCompare(right.name);
  });
}

function readUpdatedPagination(
  currentData: BrowserProjectsPageResult,
  removedProjectCount: number,
): Pick<BrowserProjectsPageResult, 'totalPages' | 'totalProjects'> {
  if (removedProjectCount === 0) {
    return {
      totalPages: currentData.totalPages,
      totalProjects: currentData.totalProjects,
    };
  }

  const totalProjects: number = Math.max(0, currentData.totalProjects - removedProjectCount);
  return {
    totalPages: Math.max(1, currentData.page, Math.ceil(totalProjects / currentData.pageSize)),
    totalProjects,
  };
}

function readProjectStatusRank(status: BrowserProjectStatus): number {
  switch (status) {
    case 'not_deployed':
      return 0;
    case 'archived':
      return 1;
    case 'stopped':
      return 2;
    case 'healthy':
      return 3;
    case 'updating':
      return 4;
    case 'needs_attention':
      return 5;
  }
}
