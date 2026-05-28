import { createProjectArchivedError, createProjectNotFoundError } from '../errors/api-business-error';
import type { QueuedExistingArtifactDeploymentBatchResult } from '../queries/deployment-batch.query.types';
import type { DeploymentRow } from '../queries/deployments.query.types';

export function requireQueuedExistingArtifactDeployments(
  result: QueuedExistingArtifactDeploymentBatchResult,
): DeploymentRow[] {
  if (result === 'project_archived') {
    throw createProjectArchivedError();
  }
  if (result === 'project_not_found') {
    throw createProjectNotFoundError();
  }

  return result;
}
