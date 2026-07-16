import type { ExistingProjectRemoteState } from '@compartment/contracts';
import {
  createProjectDeleteBlockedError,
  createProjectDeleteRequiresArchiveError,
  createProjectGitSourceBoundError,
  createProjectNameTakenError,
} from '../errors/api-business-error';
import { hasBlockingProjectDeployments } from '../queries/deployments.query';
import { getApiDatabase } from '../runtime/runtime-access';
import {
  deleteProjectWithExecutor,
  findProjectByIdWithExecutor,
  lockProjectMutationWithExecutor,
  renameProjectWithExecutor,
  setProjectArchivedAt,
  setProjectArchivedAtWithExecutor,
} from '../queries/projects.query';
import { isUniqueConstraintError } from '../queries/query-error';
import { cancelProjectProductJobsForArchive } from '../queries/product-job-claim.query';
import { cancelResourceReconcileRunsForProjectArchive } from '../queries/resource-reconcile-project.query';
import type { DeleteProjectResult, ProjectRow, ProjectsMutationTransaction } from '../queries/projects.query.types';
import {
  clearDisconnectedBindingProjectReferences,
  findActiveBindingByProjectIdWithExecutor,
  findDisconnectedBindingByProjectIdWithExecutor,
} from '../queries/source.query';
import { requireVisibleProjectSummary } from './project-visibility.service';
import { cleanupArchivedProjectRuntime, cleanupDeletedProjectRuntime } from './project-runtime-cleanup.service';
import { resolveActiveProjectScope, resolveRequiredProjectScope } from './project-scope.service';
import type { ResolvedProjectScope } from './project-scope.service.types';
import type { ProjectReadResult, ProjectScopeInput, RenameProjectServiceInput } from './projects.service.types';
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
  const project: ProjectRow = (
    await resolveRequiredProjectScope(input.principalId, input.organizationSlug, input.projectName, {
      permission: 'project.archive',
    })
  ).project;
  if (project.archivedAt === null) {
    return project;
  }

  return await setProjectArchivedAt({
    archivedAt: null,
    projectId: project.id,
    updatedAt: new Date(),
  });
}

export async function deleteProjectForPrincipal(input: ProjectScopeInput): Promise<string> {
  const projectScope: ProjectRow = (
    await resolveRequiredProjectScope(input.principalId, input.organizationSlug, input.projectName, {
      permission: 'project.delete',
    })
  ).project;
  const project: ProjectRow = await requireProjectRuntimeCleanupBeforeDelete(projectScope.id);
  await cleanupDeletedProjectRuntime(project);
  const result: DeleteProjectResult = await getApiDatabase().transaction(
    async (transaction: ProjectsMutationTransaction): Promise<DeleteProjectResult> =>
      await deleteProjectWithinTransaction(transaction, projectScope.id),
  );
  if (result.status === 'requires_archive') {
    throw createProjectDeleteRequiresArchiveError();
  }
  if (result.status === 'blocked') {
    throw createProjectDeleteBlockedError();
  }

  return result.projectName;
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

async function deleteProjectWithinTransaction(
  transaction: ProjectsMutationTransaction,
  projectId: string,
): Promise<DeleteProjectResult> {
  const project: ProjectRow = await requireMutableProject(transaction, projectId);
  if (project.archivedAt === null) {
    return {
      projectName: project.name,
      status: 'requires_archive',
    };
  }
  if (await hasBlockingProjectDeployments(transaction, project.id)) {
    return {
      projectName: project.name,
      status: 'blocked',
    };
  }
  await clearDisconnectedBindingProjectReferences(transaction, project.id, new Date());

  return {
    projectName: (await deleteProjectWithExecutor(transaction, project.id)).name,
    status: 'deleted',
  };
}

async function requireProjectRuntimeCleanupBeforeDelete(projectId: string): Promise<ProjectRow> {
  return await getApiDatabase().transaction(async (transaction: ProjectsMutationTransaction): Promise<ProjectRow> => {
    const project: ProjectRow = await requireMutableProject(transaction, projectId);
    if (project.archivedAt === null) {
      throw createProjectDeleteRequiresArchiveError();
    }
    if (await hasBlockingProjectDeployments(transaction, project.id)) {
      throw createProjectDeleteBlockedError();
    }

    return project;
  });
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
