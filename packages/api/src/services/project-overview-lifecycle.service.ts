import type {
  PermissionKey,
  ProjectLifecycleAction,
  ProjectLifecycleState,
  ProjectOperationalStatus,
} from '@compartment/contracts';
import type { DeploymentJoinedRow } from '../queries/deployments.query.types';
import type { ProjectRow } from '../queries/projects.query.types';
import { readProjectLifecycleState } from './project-lifecycle-state.service';
import { readProjectScopedOperationalStatus } from './project-operational-status.service';
import type { VisibleProjectSummary } from './project-visibility.service';

export interface ProjectLifecycleOverview {
  action: ProjectLifecycleAction | null;
  disabledReason: string | null;
  state: ProjectLifecycleState | null;
  status: ProjectOperationalStatus;
}

export function readProjectLifecycleOverview(
  project: ProjectRow,
  canManageLifecycle: boolean,
  deployments: DeploymentJoinedRow[],
  activeDeployments: DeploymentJoinedRow[],
): ProjectLifecycleOverview {
  if (project.archivedAt !== null) {
    return {
      action: null,
      disabledReason: null,
      state: null,
      status: 'archived',
    };
  }

  const state: ProjectLifecycleState = readProjectLifecycleState(deployments, activeDeployments);
  return {
    action: readLifecycleAction(state, canManageLifecycle),
    disabledReason: readLifecycleDisabledReason(state, canManageLifecycle),
    state,
    status: readProjectScopedOperationalStatus(state),
  };
}

export function readCanManageLifecycle(project: ProjectRow, permissions: readonly PermissionKey[]): boolean {
  return project.archivedAt === null && permissions.includes('project.lifecycle.write');
}

export function readCanReadDeployments(permissions: readonly PermissionKey[]): boolean {
  return permissions.includes('deployment.read');
}

export function canReadProjectRouteTargets(projectSummary: VisibleProjectSummary): boolean {
  return canReadProjectOverviewState(projectSummary) || projectSummary.permissions.includes('app.route.access');
}

export function canReadProjectOverviewState(projectSummary: VisibleProjectSummary): boolean {
  return (
    projectSummary.permissions.includes('environment.read') ||
    projectSummary.permissions.includes('deployment.read') ||
    projectSummary.permissions.includes('project.lifecycle.write')
  );
}

function readLifecycleAction(state: ProjectLifecycleState, canManageLifecycle: boolean): ProjectLifecycleAction | null {
  if (!canManageLifecycle) {
    return null;
  }
  if (state === 'running') {
    return 'stop';
  }
  return state === 'stopped' ? 'start' : null;
}

function readLifecycleDisabledReason(state: ProjectLifecycleState, canManageLifecycle: boolean): string | null {
  if (!canManageLifecycle || state === 'running' || state === 'stopped') {
    return null;
  }

  switch (state) {
    case 'needs_attention':
      return 'Needs attention';
    case 'not_deployed':
      return 'No deployments yet';
    case 'updating':
      return 'Updating';
    default:
      return null;
  }
}
