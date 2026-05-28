import { createProjectArchivedError, createProjectNotFoundError } from '../errors/api-business-error';
import type { DeploymentProjectMutationRejection } from '../services/deployment-project-mutation-result.service';

export function requireActiveProjectMutationRouteResult<T>(result: T | DeploymentProjectMutationRejection): T {
  if (result === 'project_archived') {
    throw createProjectArchivedError();
  }
  if (result === 'project_not_found') {
    throw createProjectNotFoundError();
  }

  return result;
}
