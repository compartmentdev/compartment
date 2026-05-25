import type { ProjectLifecycleState, ProjectScopedOperationalStatus } from '@compartment/contracts';

export function readProjectScopedOperationalStatus(state: ProjectLifecycleState): ProjectScopedOperationalStatus {
  return state === 'running' ? 'healthy' : state;
}
