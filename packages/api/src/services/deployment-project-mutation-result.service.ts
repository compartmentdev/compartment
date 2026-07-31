import type { DeploymentProjectMutationRejection } from '../queries/deployment-project-mutation.query.types';

export function isDeploymentProjectMutationRejection(
  value: string | object | null | undefined,
): value is DeploymentProjectMutationRejection {
  return value === 'project_archived' || value === 'project_not_found';
}

export type { DeploymentProjectMutationRejection };
