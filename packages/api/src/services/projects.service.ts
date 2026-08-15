import type { ExistingProjectRemoteState } from '@compartment/contracts';
import {
  createProjectDeleteBlockedError,
  createProjectDeleteRequiresArchiveError,
  createProjectLifecycleNotAvailableError,
  createProjectNameTakenError,
} from '../errors/api-business-error';
import { getApiDatabase } from '../runtime/runtime-access';
import { hasBlockingProjectDeployments } from '../queries/deployments.query';
import { stopInactiveQueuedProjectDeploymentsForArchivedProject } from '../queries/deployment-archive.query';
import { setProjectArchivedAtWithExecutor } from '../queries/projects.query';
import {
  activateProjectTeardownWithTransaction,
  lockProjectTeardownStateWithTransaction,
  prepareProjectTeardownWithTransaction,
} from '../queries/project-teardown.query';
import type {
  ProjectTeardownObservation,
  ProjectTeardownPreparationResult,
} from '../queries/project-provisioning.query.types';
import { isUniqueConstraintError } from '../queries/query-error';
import { cancelProjectProductJobsForArchive } from '../queries/product-job-claim.query';
import { cancelResourceReconcileRunsForProjectArchive } from '../queries/resource-reconcile-project.query';
import type { ProjectRow, ProjectsMutationTransaction } from '../queries/projects.query.types';
import {
  findActiveBindingByProjectIdWithExecutor,
  findDisconnectedBindingByProjectIdWithExecutor,
} from '../queries/source.query';
import { requireVisibleProjectSummary } from './project-visibility.service';
import { cleanupArchivedProjectRuntime } from './project-runtime-cleanup.service';
import { resolveActiveProjectScope } from './project-scope.service';
import type { ResolvedProjectScope } from './project-scope.service.types';
import { cleanupPreparedProjectRuntime } from './project-teardown-preparation.service';
import {
  ensureArchivedProject,
  projectArchiveMutation,
  renameAuthorizedProject,
  requireArchivableProject,
  requireLockedProject,
  requireMutableProject,
  requireProjectOrganizationContext,
  resolveActiveProjectMutationScope,
  resolveProjectMutationScope,
} from './project-mutation-scope.service';
import type {
  ProjectDeletePreparation,
  ProjectDeleteResult,
  ProjectReadResult,
  ProjectScopeInput,
  RenameProjectServiceInput,
} from './projects.service.types';
import { excludeGitSourceProjectBindingWithinTransaction } from './git-source/git-source-exclusion.service';

export async function renameProjectForPrincipal(input: RenameProjectServiceInput): Promise<ProjectRow> {
  const projectScope: ResolvedProjectScope = await resolveActiveProjectMutationScope(input, 'project.settings.write');
  if (projectScope.project.name === input.nextProjectName) {
    return projectScope.project;
  }

  try {
    return await getApiDatabase().transaction(async (transaction: ProjectsMutationTransaction): Promise<ProjectRow> => {
      return await renameAuthorizedProject(
        transaction,
        projectScope.organization.id,
        projectScope.project.id,
        input.nextProjectName,
      );
    });
  } catch (error) {
    const mutationError: Error | undefined = error instanceof Error ? error : undefined;
    throw mapProjectMutationError(mutationError);
  }
}

export async function archiveProjectForPrincipal(input: ProjectScopeInput): Promise<ProjectRow> {
  const projectScope: ResolvedProjectScope = await resolveProjectMutationScope(input, 'project.archive');
  const archivedProject: ProjectRow = await getApiDatabase().transaction(
    async (transaction: ProjectsMutationTransaction): Promise<ProjectRow> => {
      const project: ProjectRow = await requireArchivableProject(
        transaction,
        projectScope.organization.id,
        projectScope.project.id,
      );
      const archivedAt: Date = new Date();
      await excludeGitSourceProjectBindingWithinTransaction(transaction, project.id, input.principalId, archivedAt);
      const persistedArchivedProject: ProjectRow = await ensureArchivedProject(
        transaction,
        projectScope.organization.id,
        project,
        archivedAt,
      );
      await stopInactiveQueuedProjectDeploymentsForArchivedProject(transaction, project.id, archivedAt);
      await cancelProjectProductJobsForArchive(transaction, project.id, archivedAt);
      await cancelResourceReconcileRunsForProjectArchive(transaction, project.id, archivedAt);
      return persistedArchivedProject;
    },
  );
  await cleanupArchivedProjectRuntime(archivedProject);
  return archivedProject;
}

export async function unarchiveProjectForPrincipal(input: ProjectScopeInput): Promise<ProjectRow> {
  const projectScope: ResolvedProjectScope = await resolveProjectMutationScope(input, 'project.archive');
  if (projectScope.project.archivedAt === null) {
    return projectScope.project;
  }

  return await getApiDatabase().transaction(async (transaction: ProjectsMutationTransaction): Promise<ProjectRow> => {
    await requireProjectOrganizationContext(transaction, projectScope.organization.id, projectScope.project.id);
    const teardown: ProjectTeardownObservation | null = await lockProjectTeardownStateWithTransaction(
      transaction,
      projectScope.project.id,
    );
    const project: ProjectRow = await requireLockedProject(
      transaction,
      projectScope.organization.id,
      projectScope.project.id,
    );
    if (teardown !== null) {
      throw createProjectLifecycleNotAvailableError();
    }
    return await setProjectArchivedAtWithExecutor(
      transaction,
      projectArchiveMutation(projectScope.organization.id, project, null),
    );
  });
}

export async function deleteProjectForPrincipal(input: ProjectScopeInput): Promise<ProjectDeleteResult> {
  const projectScope: ResolvedProjectScope = await resolveProjectMutationScope(input, 'project.delete');
  const preparation: ProjectDeletePreparation = await prepareProjectRuntimeCleanupBeforeDelete(
    projectScope.organization.id,
    projectScope.project.id,
  );
  if (preparation.preparationLeaseId !== null) {
    await cleanupPreparedProjectRuntime(preparation.project, preparation.preparationLeaseId);
    await activateProjectTeardownAfterRuntimeCleanup(
      projectScope.organization.id,
      preparation.project.id,
      preparation.preparationLeaseId,
    );
  }
  return {
    projectName: preparation.project.name,
    recoveredTerminalFailureMessage: preparation.terminalFailureMessage,
  };
}

export async function getActiveProjectForPrincipal(input: ProjectScopeInput): Promise<ProjectReadResult> {
  const projectScope: ResolvedProjectScope = await resolveActiveProjectScope(
    input.principalId,
    input.organizationSlug,
    input.projectName,
  );
  const project: ProjectRow = (
    await requireVisibleProjectSummary(projectScope.organization.id, input.principalId, projectScope.project)
  ).project;

  return {
    project,
    remoteState: await readProjectRemoteState(project.id),
  };
}

async function prepareProjectRuntimeCleanupBeforeDelete(
  organizationId: string,
  projectId: string,
): Promise<ProjectDeletePreparation> {
  return await getApiDatabase().transaction(
    async (transaction: ProjectsMutationTransaction): Promise<ProjectDeletePreparation> => {
      await requireLockedProject(transaction, organizationId, projectId);
      const teardown: ProjectTeardownPreparationResult = await prepareProjectTeardownWithTransaction(
        transaction,
        projectId,
      );
      const project: ProjectRow = await requireArchivedDeletableProject(transaction, organizationId, projectId);
      return {
        preparationLeaseId: teardown.preparationLeaseId,
        project,
        terminalFailureMessage: teardown.recoveredTerminalFailureMessage,
      };
    },
  );
}

async function activateProjectTeardownAfterRuntimeCleanup(
  organizationId: string,
  projectId: string,
  preparationLeaseId: string,
): Promise<void> {
  await getApiDatabase().transaction(async (transaction: ProjectsMutationTransaction): Promise<void> => {
    await activateProjectTeardownWithTransaction(transaction, projectId, preparationLeaseId);
    await requireArchivedDeletableProject(transaction, organizationId, projectId);
  });
}

async function requireArchivedDeletableProject(
  transaction: ProjectsMutationTransaction,
  organizationId: string,
  projectId: string,
): Promise<ProjectRow> {
  const project: ProjectRow = await requireMutableProject(transaction, organizationId, projectId);
  if (project.archivedAt === null) {
    throw createProjectDeleteRequiresArchiveError();
  }
  await stopInactiveQueuedProjectDeploymentsForArchivedProject(transaction, project.id, new Date());
  if (await hasBlockingProjectDeployments(transaction, project.id)) {
    throw createProjectDeleteBlockedError();
  }
  return project;
}

function mapProjectMutationError(error: Error | null | undefined): Error {
  if (isUniqueConstraintError(error)) {
    return createProjectNameTakenError();
  }

  return error instanceof Error ? error : new Error('Project mutation failed.');
}

async function readProjectRemoteState(projectId: string): Promise<ExistingProjectRemoteState> {
  if ((await findActiveBindingByProjectIdWithExecutor(getApiDatabase(), projectId)) !== undefined) {
    return 'active';
  }
  if ((await findDisconnectedBindingByProjectIdWithExecutor(getApiDatabase(), projectId)) !== undefined) {
    return 'disconnected';
  }

  return 'active';
}
