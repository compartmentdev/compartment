import type { PermissionKey } from '@compartment/contracts';
import { createProjectGitSourceBoundError } from '../errors/api-business-error';
import {
  findProjectByOrganizationAndIdWithExecutor,
  lockProjectMutationWithExecutor,
  renameProjectWithExecutor,
  setProjectArchivedAtWithExecutor,
} from '../queries/projects.query';
import { invalidateProjectProvisioningForRenameWithTransaction } from '../queries/project-provisioning.query';
import type {
  ProjectRow,
  ProjectsMutationTransaction,
  SetProjectArchivedAtInput,
} from '../queries/projects.query.types';
import { findActiveBindingByProjectIdWithExecutor } from '../queries/source.query';
import { resolveActiveProjectScope, resolveRequiredProjectScope } from './project-scope.service';
import type { ResolvedProjectScope } from './project-scope.service.types';
import type { ProjectScopeInput } from './projects.service.types';

export async function resolveActiveProjectMutationScope(
  input: ProjectScopeInput,
  permission: PermissionKey,
): Promise<ResolvedProjectScope> {
  return await resolveActiveProjectScope(input.principalId, input.organizationSlug, input.projectName, { permission });
}

export async function resolveProjectMutationScope(
  input: ProjectScopeInput,
  permission: PermissionKey,
): Promise<ResolvedProjectScope> {
  return await resolveRequiredProjectScope(input.principalId, input.organizationSlug, input.projectName, {
    permission,
  });
}

export async function ensureArchivedProject(
  transaction: ProjectsMutationTransaction,
  organizationId: string,
  project: ProjectRow,
  archivedAt: Date,
): Promise<ProjectRow> {
  if (project.archivedAt !== null) {
    return project;
  }
  return await setProjectArchivedAtWithExecutor(
    transaction,
    projectArchiveMutation(organizationId, project, archivedAt),
  );
}

export async function renameAuthorizedProject(
  transaction: ProjectsMutationTransaction,
  organizationId: string,
  projectId: string,
  name: string,
): Promise<ProjectRow> {
  const project: ProjectRow = await requireMutableProject(transaction, organizationId, projectId);
  const now: Date = new Date();
  const renamedProject: ProjectRow = await renameProjectWithExecutor(transaction, {
    name,
    organizationId,
    projectId: project.id,
    updatedAt: now,
  });
  await invalidateProjectProvisioningForRenameWithTransaction(transaction, project.id, now);
  return renamedProject;
}

export async function requireMutableProject(
  transaction: ProjectsMutationTransaction,
  organizationId: string,
  projectId: string,
): Promise<ProjectRow> {
  const project: ProjectRow = await requireLockedProject(transaction, organizationId, projectId);
  if ((await findActiveBindingByProjectIdWithExecutor(transaction, projectId)) !== undefined) {
    throw createProjectGitSourceBoundError();
  }
  return project;
}

export async function requireArchivableProject(
  transaction: ProjectsMutationTransaction,
  organizationId: string,
  projectId: string,
): Promise<ProjectRow> {
  return await requireLockedProject(transaction, organizationId, projectId);
}

export async function requireLockedProject(
  transaction: ProjectsMutationTransaction,
  organizationId: string,
  projectId: string,
): Promise<ProjectRow> {
  await lockProjectMutationWithExecutor(transaction, organizationId, projectId);
  const project: ProjectRow | undefined = await findProjectByOrganizationAndIdWithExecutor(
    transaction,
    organizationId,
    projectId,
  );
  if (project === undefined) {
    throw new Error('Project mutation failed.');
  }
  return project;
}

export async function requireProjectOrganizationContext(
  transaction: ProjectsMutationTransaction,
  organizationId: string,
  projectId: string,
): Promise<void> {
  if ((await findProjectByOrganizationAndIdWithExecutor(transaction, organizationId, projectId)) === undefined) {
    throw new Error('Project mutation failed.');
  }
}

export function projectArchiveMutation(
  organizationId: string,
  project: ProjectRow,
  archivedAt: Date | null,
): SetProjectArchivedAtInput {
  return {
    archivedAt,
    organizationId,
    projectId: project.id,
    updatedAt: archivedAt ?? new Date(),
  };
}
