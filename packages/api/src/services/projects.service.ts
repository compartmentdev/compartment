import type { ExistingProjectRemoteState } from '@compartment/contracts';
import {
  createProjectDeleteBlockedError,
  createProjectDeleteRequiresArchiveError,
  createProjectGitSourceBoundError,
  createProjectLifecycleNotAvailableError,
  createProjectNameTakenError,
} from '../errors/api-business-error';
import { hasBlockingProjectDeployments } from '../queries/deployments.query';
import { getApiDatabase } from '../runtime/runtime-access';
import {
  findProjectByIdWithExecutor,
  lockProjectMutationWithExecutor,
  renameProjectWithExecutor,
  setProjectArchivedAtWithExecutor,
} from '../queries/projects.query';
import {
  activateProjectTeardownWithTransaction,
  lockProjectTeardownStateWithTransaction,
  prepareProjectTeardownWithTransaction,
} from '../queries/project-teardown.query';
import type { ProjectTeardownObservation } from '../queries/project-provisioning.query.types';
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
import { resolveActiveProjectScope, resolveRequiredProjectScope } from './project-scope.service';
import type { ResolvedProjectScope } from './project-scope.service.types';
import { cleanupPreparedProjectRuntime } from './project-teardown-preparation.service';
import type {
  ProjectDeletePreparation,
  ProjectReadResult,
  ProjectScopeInput,
  RenameProjectServiceInput,
} from './projects.service.types';
import { excludeGitSourceProjectBindingWithinTransaction } from './git-source/git-source-exclusion.service';

export async function renameProjectForPrincipal(input: RenameProjectServiceInput): Promise<ProjectRow> {
  const projectScope: ProjectRow = (
    await resolveActiveProjectScope(input.principalId, input.organizationSlug, input.projectName, {
      permission: 'project.settings.write',
    })
  ).project;
  if (projectScope.name === input.nextProjectName) {
    return projectScope;
  }

  try {
    return await getApiDatabase().transaction(async (transaction: ProjectsMutationTransaction): Promise<ProjectRow> => {
      const project: ProjectRow = await requireMutableProject(transaction, projectScope.id);
      return await renameProjectWithExecutor(transaction, {
        name: input.nextProjectName,
        projectId: project.id,
        updatedAt: new Date(),
      });
    });
  } catch (error) {
    const mutationError: Error | undefined = error instanceof Error ? error : undefined;
    throw mapProjectMutationError(mutationError);
  }
}

export async function archiveProjectForPrincipal(input: ProjectScopeInput): Promise<ProjectRow> {
  const projectScope: ProjectRow = (
    await resolveRequiredProjectScope(input.principalId, input.organizationSlug, input.projectName, {
      permission: 'project.archive',
    })
  ).project;
  const archivedProject: ProjectRow = await getApiDatabase().transaction(
    async (transaction: ProjectsMutationTransaction): Promise<ProjectRow> => {
      const project: ProjectRow = await requireArchivableProject(transaction, projectScope.id);
      await excludeGitSourceProjectBindingWithinTransaction(transaction, project.id, input.principalId, new Date());
      const persistedArchivedProject: ProjectRow = await ensureArchivedProject(transaction, project);
      await cancelProjectProductJobsForArchive(transaction, project.id, new Date());
      await cancelResourceReconcileRunsForProjectArchive(transaction, project.id, new Date());
      return persistedArchivedProject;
    },
  );
  await cleanupArchivedProjectRuntime(archivedProject);
  return archivedProject;
}

export async function unarchiveProjectForPrincipal(input: ProjectScopeInput): Promise<ProjectRow> {
  const projectScope: ProjectRow = (
    await resolveRequiredProjectScope(input.principalId, input.organizationSlug, input.projectName, {
      permission: 'project.archive',
    })
  ).project;
  if (projectScope.archivedAt === null) {
    return projectScope;
  }

  return await getApiDatabase().transaction(async (transaction: ProjectsMutationTransaction): Promise<ProjectRow> => {
    const teardown: ProjectTeardownObservation | null = await lockProjectTeardownStateWithTransaction(
      transaction,
      projectScope.id,
    );
    const project: ProjectRow = await requireLockedProject(transaction, projectScope.id);
    if (teardown !== null) {
      throw createProjectLifecycleNotAvailableError();
    }
    return await setProjectArchivedAtWithExecutor(transaction, {
      archivedAt: null,
      projectId: project.id,
      updatedAt: new Date(),
    });
  });
}

export async function deleteProjectForPrincipal(input: ProjectScopeInput): Promise<string> {
  const projectScope: ProjectRow = (
    await resolveRequiredProjectScope(input.principalId, input.organizationSlug, input.projectName, {
      permission: 'project.delete',
    })
  ).project;
  const preparation: ProjectDeletePreparation = await prepareProjectRuntimeCleanupBeforeDelete(projectScope.id);
  if (preparation.preparationLeaseId !== null) {
    await cleanupPreparedProjectRuntime(preparation.project, preparation.preparationLeaseId);
    await activateProjectTeardownAfterRuntimeCleanup(preparation.project.id, preparation.preparationLeaseId);
  }
  return preparation.project.name;
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

async function ensureArchivedProject(
  transaction: ProjectsMutationTransaction,
  project: ProjectRow,
): Promise<ProjectRow> {
  if (project.archivedAt !== null) {
    return project;
  }

  const now: Date = new Date();
  return await setProjectArchivedAtWithExecutor(transaction, {
    archivedAt: now,
    projectId: project.id,
    updatedAt: now,
  });
}

async function prepareProjectRuntimeCleanupBeforeDelete(projectId: string): Promise<ProjectDeletePreparation> {
  return await getApiDatabase().transaction(
    async (transaction: ProjectsMutationTransaction): Promise<ProjectDeletePreparation> => {
      const preparationLeaseId: string | null = await prepareProjectTeardownWithTransaction(transaction, projectId);
      const project: ProjectRow = await requireDeletableProject(transaction, projectId);
      return { preparationLeaseId, project };
    },
  );
}

async function activateProjectTeardownAfterRuntimeCleanup(
  projectId: string,
  preparationLeaseId: string,
): Promise<void> {
  await getApiDatabase().transaction(async (transaction: ProjectsMutationTransaction): Promise<void> => {
    await activateProjectTeardownWithTransaction(transaction, projectId, preparationLeaseId);
    await requireDeletableProject(transaction, projectId);
  });
}

async function requireDeletableProject(
  transaction: ProjectsMutationTransaction,
  projectId: string,
): Promise<ProjectRow> {
  const project: ProjectRow = await requireMutableProject(transaction, projectId);
  if (project.archivedAt === null) {
    throw createProjectDeleteRequiresArchiveError();
  }
  if (await hasBlockingProjectDeployments(transaction, project.id)) {
    throw createProjectDeleteBlockedError();
  }

  return project;
}

async function requireMutableProject(transaction: ProjectsMutationTransaction, projectId: string): Promise<ProjectRow> {
  const project: ProjectRow = await requireLockedProject(transaction, projectId);
  if ((await findActiveBindingByProjectIdWithExecutor(transaction, projectId)) !== undefined) {
    throw createProjectGitSourceBoundError();
  }

  return project;
}

async function requireArchivableProject(
  transaction: ProjectsMutationTransaction,
  projectId: string,
): Promise<ProjectRow> {
  return await requireLockedProject(transaction, projectId);
}

async function requireLockedProject(transaction: ProjectsMutationTransaction, projectId: string): Promise<ProjectRow> {
  await lockProjectMutationWithExecutor(transaction, projectId);
  const project: ProjectRow | undefined = await findProjectByIdWithExecutor(transaction, projectId);
  if (project === undefined) {
    throw new Error('Project mutation failed.');
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
