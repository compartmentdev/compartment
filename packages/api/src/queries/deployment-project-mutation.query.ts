import { findProjectByIdWithExecutor, lockProjectMutationWithExecutor } from './projects.query';
import type { ProjectRow, ProjectsMutationTransaction } from './projects.query.types';
import type { DeploymentProjectMutationStatus } from './deployment-project-mutation.query.types';

export async function lockActiveProjectDeploymentMutationWithExecutor(
  transaction: ProjectsMutationTransaction,
  projectId: string,
): Promise<DeploymentProjectMutationStatus> {
  await lockProjectMutationWithExecutor(transaction, projectId);
  const project: ProjectRow | undefined = await findProjectByIdWithExecutor(transaction, projectId);
  if (project === undefined) {
    return 'project_not_found';
  }

  return project.archivedAt === null ? 'active' : 'project_archived';
}
