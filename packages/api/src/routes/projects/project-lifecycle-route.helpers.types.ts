import type { ProjectLifecycleResult } from '../../services/project-lifecycle.service.types';

export interface ProjectLifecycleRouteInput {
  environmentName: string;
  organizationSlug: string;
  principalId: string;
  projectName: string;
}

export type ProjectLifecycleRouteExecutor = (input: ProjectLifecycleRouteInput) => Promise<ProjectLifecycleResult>;
