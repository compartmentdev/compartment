import { readGitSourceDescriptorDirectory, type GitSourceBindingInput } from '@compartment/contracts';
import { createGitSourceConflictError } from '../../errors/api-business-error';
import { createId } from '../../lib/tokens';
import { findProjectByOrganizationAndNameWithExecutor } from '../../queries/projects.query';
import type { ProjectRow } from '../../queries/projects.query.types';
import type {
  CreateSourceBindingBranchMappingInput,
  CreateSourceBindingInput,
  CreateSourceInput,
  SourceBindingRow,
  SourceMutationTransaction,
  UpdateSourceToActiveInput,
} from '../../queries/source.query.types';
import type { GitRepositoryMetadata } from './git-source-provider.types';

interface GitSourceUpsertInput {
  actorPrincipalId: string;
  autoAdoptNewApps: boolean;
  defaultAutoDeployEnabled: boolean;
  defaultEnvironmentName: string;
  installationId: string;
  organizationId: string;
  providerHost: string;
  providerRegistrationId: string;
  repository: GitRepositoryMetadata;
  syncBranchName: string;
}

export function buildCreateSourceInput(input: GitSourceUpsertInput, now: Date): CreateSourceInput {
  return {
    autoAdoptNewApps: input.autoAdoptNewApps,
    createdByPrincipalId: input.actorPrincipalId,
    defaultBranchName: input.repository.defaultBranchName,
    defaultAutoDeployEnabled: input.defaultAutoDeployEnabled,
    defaultEnvironmentName: input.defaultEnvironmentName,
    displayName: readGitSourceDisplayName(input.repository.repositoryOwner, input.repository.repositoryName),
    id: createId('src'),
    organizationId: input.organizationId,
    providerHost: input.providerHost,
    providerInstallationId: input.installationId,
    providerRegistrationId: input.providerRegistrationId,
    repositoryCloneUrl: input.repository.repositoryCloneUrl,
    repositoryExternalId: input.repository.repositoryExternalId,
    repositoryName: input.repository.repositoryName,
    repositoryOwner: input.repository.repositoryOwner,
    status: 'active',
    syncBranchName: input.syncBranchName,
    type: 'git',
    updatedAt: now,
  };
}

export function buildUpdateSourceInput(
  input: Omit<GitSourceUpsertInput, 'organizationId' | 'actorPrincipalId'>,
  sourceId: string,
  now: Date,
): UpdateSourceToActiveInput {
  return {
    autoAdoptNewApps: input.autoAdoptNewApps,
    defaultBranchName: input.repository.defaultBranchName,
    defaultAutoDeployEnabled: input.defaultAutoDeployEnabled,
    defaultEnvironmentName: input.defaultEnvironmentName,
    displayName: readGitSourceDisplayName(input.repository.repositoryOwner, input.repository.repositoryName),
    providerInstallationId: input.installationId,
    providerRegistrationId: input.providerRegistrationId,
    repositoryCloneUrl: input.repository.repositoryCloneUrl,
    repositoryName: input.repository.repositoryName,
    repositoryOwner: input.repository.repositoryOwner,
    sourceId,
    syncBranchName: input.syncBranchName,
    updatedAt: now,
  };
}

export function buildCreateSourceBindingInput(
  actorPrincipalId: string,
  sourceId: string,
  bindingRequest: GitSourceBindingInput,
  projectId: string,
  now: Date,
  watchPathsJson: string = '[]',
): CreateSourceBindingInput {
  return {
    autoDeployEnabled: bindingRequest.autoDeployEnabled,
    createdByPrincipalId: actorPrincipalId,
    descriptorDirectory: readGitSourceDescriptorDirectory(bindingRequest.descriptorPath),
    descriptorPath: bindingRequest.descriptorPath,
    id: createId('sbd'),
    projectId,
    projectName: bindingRequest.projectName,
    sourceId,
    status: 'active',
    updatedAt: now,
    watchPathsJson,
  };
}

export function buildCreateSourceBindingBranchMappingInput(
  sourceBindingId: string,
  bindingRequest: GitSourceBindingInput,
  now: Date,
): CreateSourceBindingBranchMappingInput {
  return {
    branchName: bindingRequest.branchMapping.branchName,
    environmentName: bindingRequest.branchMapping.environmentName,
    id: createId('sbm'),
    sourceBindingId,
    updatedAt: now,
  };
}

export function hasActiveProjectState(project: ProjectRow | undefined): project is ProjectRow {
  return project?.archivedAt === null;
}

export async function findAvailableProjectByOrganizationAndName(
  transaction: SourceMutationTransaction,
  organizationId: string,
  projectName: string,
): Promise<ProjectRow | undefined> {
  const existingProject: ProjectRow | undefined = await findProjectByOrganizationAndNameWithExecutor(
    transaction,
    organizationId,
    projectName,
  );
  if (existingProject !== undefined && existingProject.archivedAt !== null) {
    throw createArchivedProjectConflictError(projectName);
  }

  return existingProject;
}

export function assertDisconnectedBindingProjectMatch(
  binding: SourceBindingRow,
  bindingRequest: GitSourceBindingInput,
  projectId: string,
): void {
  if (binding.projectId !== projectId) {
    throw createDisconnectedBindingProjectConflictError(bindingRequest);
  }
}

export function assertDisconnectedBindingProjectNameMatch(
  binding: SourceBindingRow,
  bindingRequest: GitSourceBindingInput,
): void {
  if (binding.projectName !== bindingRequest.projectName) {
    throw createDisconnectedBindingProjectConflictError(bindingRequest);
  }
}

function createDisconnectedBindingProjectConflictError(bindingRequest: GitSourceBindingInput): Error {
  return createGitSourceConflictError(
    `Descriptor ${bindingRequest.descriptorPath} is already linked to a different disconnected project.`,
  );
}

export function createArchivedProjectConflictError(projectName: string): Error {
  return createGitSourceConflictError(`Project "${projectName}" is archived.`);
}

function readGitSourceDisplayName(repositoryOwner: string, repositoryName: string): string {
  return `${repositoryOwner}/${repositoryName}`;
}
