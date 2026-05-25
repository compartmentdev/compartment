import type { ProjectRow } from '../queries/projects.query.types';
import {
  buildProjectLiveContext,
  resolveVisibleProjectOverviewState,
  type ProjectLiveContext,
  type VisibleProjectOverviewState,
} from './project-list-overview.service';
import {
  readCanManageLifecycle,
  readProjectLifecycleOverview,
  type ProjectLifecycleOverview,
} from './project-overview-lifecycle.service';
import type { VisibleProjectSummary } from './project-visibility.service';
import type { ProjectStatusListItem } from './projects.service.types';

interface ProjectStatusInput {
  projects: VisibleProjectSummary[];
}

export async function buildProjectStatusSummaries(input: ProjectStatusInput): Promise<ProjectStatusListItem[]> {
  const context: ProjectLiveContext = await buildProjectLiveContext(input.projects.map(readProjectRow));

  return input.projects.map(
    (project: VisibleProjectSummary): ProjectStatusListItem => buildProjectStatusSummary(project, context),
  );
}

function buildProjectStatusSummary(
  projectSummary: VisibleProjectSummary,
  context: ProjectLiveContext,
): ProjectStatusListItem {
  const project: ProjectRow = projectSummary.project;
  const visibleState: VisibleProjectOverviewState = resolveVisibleProjectOverviewState(projectSummary, context);
  const canManageLifecycle: boolean = readCanManageLifecycle(project, projectSummary.permissions);
  const lifecycle: ProjectLifecycleOverview = readProjectLifecycleOverview(
    project,
    canManageLifecycle,
    visibleState.deployments,
    visibleState.activeDeployments,
  );

  return {
    id: project.id,
    lifecycleAction: lifecycle.action,
    lifecycleDisabledReason: lifecycle.disabledReason,
    lifecycleState: lifecycle.state,
    openTargets: visibleState.openTargets,
    routeUrl: visibleState.routeUrl,
    status: lifecycle.status,
  };
}

function readProjectRow(project: VisibleProjectSummary): ProjectRow {
  return project.project;
}
