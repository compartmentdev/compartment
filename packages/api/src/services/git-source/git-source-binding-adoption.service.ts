import { readGitSourceDescriptorDirectory, type GitSourceBindingInput } from '@compartment/contracts';
import { createGitSourceConflictError } from '../../errors/api-business-error';
import { createId } from '../../lib/tokens';
import {
  createOrGetProjectWithExecutor,
  findProjectByOrganizationAndIdWithExecutor,
  lockProjectMutationWithExecutor,
} from '../../queries/projects.query';
import type { ProjectRow } from '../../queries/projects.query.types';
import {
  createSourceBinding,
  findActiveBindingByProjectIdWithExecutor,
  findDisconnectedBindingByDescriptorPath,
  findDisconnectedBindingByIdWithExecutor,
  replaceBranchMappingsForBinding,
  updateSourceBindingToActive,
} from '../../queries/source.query';
import type {
  CreateSourceBindingBranchMappingInput,
  SourceBindingRow,
  SourceMutationTransaction,
} from '../../queries/source.query.types';
import {
  assertDisconnectedBindingProjectMatch,
  assertDisconnectedBindingProjectNameMatch,
  buildCreateSourceBindingBranchMappingInput,
  buildCreateSourceBindingInput,
  createArchivedProjectConflictError,
  findAvailableProjectByOrganizationAndName,
  hasActiveProjectState,
} from './git-source-connect.persistence.support';

export interface AdoptGitSourceBindingInput {
  actorPrincipalId: string;
  binding: GitSourceBindingInput;
  movedSourceBindingId?: string | undefined;
  organizationId: string;
  sourceId: string;
  watchPathsJson?: string | undefined;
}

interface ConnectedBindingWriteContext {
  actorPrincipalId: string;
  movedSourceBindingId: string | undefined;
  now: Date;
  projectId: string;
  sourceId: string;
  watchPathsJson: string | undefined;
}

export async function adoptGitSourceBinding(
  transaction: SourceMutationTransaction,
  input: AdoptGitSourceBindingInput,
  now: Date,
): Promise<SourceBindingRow> {
  const project: ProjectRow = await requireAvailableProject(
    transaction,
    input.organizationId,
    input.binding.projectName,
    now,
  );
  const connectedBindingContext: ConnectedBindingWriteContext = {
    actorPrincipalId: input.actorPrincipalId,
    movedSourceBindingId: input.movedSourceBindingId,
    now,
    projectId: project.id,
    sourceId: input.sourceId,
    watchPathsJson: input.watchPathsJson,
  };
  const binding: SourceBindingRow = await upsertConnectedBinding(transaction, connectedBindingContext, input.binding);
  await replaceConnectedBindingBranchMapping(transaction, binding.id, input.binding, now);
  return binding;
}

async function requireAvailableProject(
  transaction: SourceMutationTransaction,
  organizationId: string,
  projectName: string,
  now: Date,
): Promise<ProjectRow> {
  const project: ProjectRow = await resolveConnectProject(transaction, organizationId, projectName, now);
  const lockedProject: ProjectRow = await readLockedAvailableProject(
    transaction,
    organizationId,
    project.id,
    projectName,
  );
  const activeBinding: SourceBindingRow | undefined = await findActiveBindingByProjectIdWithExecutor(
    transaction,
    lockedProject.id,
  );
  if (activeBinding !== undefined) {
    throw createGitSourceConflictError(`Project "${lockedProject.name}" already has an active Git binding.`);
  }

  return lockedProject;
}

async function upsertConnectedBinding(
  transaction: SourceMutationTransaction,
  context: ConnectedBindingWriteContext,
  bindingRequest: GitSourceBindingInput,
): Promise<SourceBindingRow> {
  const disconnectedBinding: SourceBindingRow | undefined = await findDisconnectedBindingByDescriptorPath(
    transaction,
    context.sourceId,
    bindingRequest.descriptorPath,
  );
  if (disconnectedBinding !== undefined) {
    return await reactivateSourceBinding(transaction, context, disconnectedBinding, bindingRequest);
  }

  const movedDisconnectedBinding: SourceBindingRow | null = await readMigratableDisconnectedSourceBinding(
    transaction,
    context.sourceId,
    context.movedSourceBindingId,
  );
  return movedDisconnectedBinding === null
    ? await createNewSourceBinding(transaction, context, bindingRequest)
    : await reactivateSourceBinding(transaction, context, movedDisconnectedBinding, bindingRequest);
}

async function replaceConnectedBindingBranchMapping(
  transaction: SourceMutationTransaction,
  sourceBindingId: string,
  bindingRequest: GitSourceBindingInput,
  now: Date,
): Promise<void> {
  const branchMappingInput: CreateSourceBindingBranchMappingInput = buildCreateSourceBindingBranchMappingInput(
    sourceBindingId,
    bindingRequest,
    now,
  );
  await replaceBranchMappingsForBinding(transaction, sourceBindingId, branchMappingInput);
}

async function readMigratableDisconnectedSourceBinding(
  transaction: SourceMutationTransaction,
  sourceId: string,
  sourceBindingId: string | undefined,
): Promise<SourceBindingRow | null> {
  if (sourceBindingId === undefined) {
    return null;
  }

  const binding: SourceBindingRow | undefined = await findDisconnectedBindingByIdWithExecutor(
    transaction,
    sourceBindingId,
  );
  if (binding?.sourceId !== sourceId || binding.status !== 'disconnected') {
    return null;
  }

  return binding;
}

async function resolveConnectProject(
  transaction: SourceMutationTransaction,
  organizationId: string,
  projectName: string,
  now: Date,
): Promise<ProjectRow> {
  await findAvailableProjectByOrganizationAndName(transaction, organizationId, projectName);

  return await createOrGetProjectWithExecutor(transaction, {
    id: createId('prj'),
    name: projectName,
    organizationId,
    updatedAt: now,
  });
}

async function readLockedAvailableProject(
  transaction: SourceMutationTransaction,
  organizationId: string,
  projectId: string,
  projectName: string,
): Promise<ProjectRow> {
  await lockProjectMutationWithExecutor(transaction, organizationId, projectId);
  const lockedProject: ProjectRow | undefined = await findProjectByOrganizationAndIdWithExecutor(
    transaction,
    organizationId,
    projectId,
  );
  if (!hasActiveProjectState(lockedProject)) {
    throw createArchivedProjectConflictError(projectName);
  }
  return lockedProject;
}

async function reactivateSourceBinding(
  transaction: SourceMutationTransaction,
  context: ConnectedBindingWriteContext,
  binding: SourceBindingRow,
  bindingRequest: GitSourceBindingInput,
): Promise<SourceBindingRow> {
  if (binding.projectId === null) {
    return await createReplacementSourceBinding(transaction, context, binding, bindingRequest);
  }
  assertDisconnectedBindingProjectMatch(binding, bindingRequest, context.projectId);

  return await updateSourceBindingToActive(transaction, {
    autoDeployEnabled: bindingRequest.autoDeployEnabled,
    descriptorDirectory: readGitSourceDescriptorDirectory(bindingRequest.descriptorPath),
    descriptorPath: bindingRequest.descriptorPath,
    projectId: context.projectId,
    projectName: bindingRequest.projectName,
    sourceBindingId: binding.id,
    updatedAt: context.now,
    watchPathsJson: readReactivatedBindingWatchPathsJson(binding, context.watchPathsJson),
  });
}

async function createReplacementSourceBinding(
  transaction: SourceMutationTransaction,
  context: ConnectedBindingWriteContext,
  binding: SourceBindingRow,
  bindingRequest: GitSourceBindingInput,
): Promise<SourceBindingRow> {
  assertDisconnectedBindingProjectNameMatch(binding, bindingRequest);
  return await createNewSourceBinding(transaction, { ...context, sourceId: binding.sourceId }, bindingRequest);
}

async function createNewSourceBinding(
  transaction: SourceMutationTransaction,
  context: ConnectedBindingWriteContext,
  bindingRequest: GitSourceBindingInput,
): Promise<SourceBindingRow> {
  return await createSourceBinding(
    transaction,
    buildCreateSourceBindingInput(
      context.actorPrincipalId,
      context.sourceId,
      bindingRequest,
      context.projectId,
      context.now,
      context.watchPathsJson ?? '[]',
    ),
  );
}

function readReactivatedBindingWatchPathsJson(binding: SourceBindingRow, watchPathsJson: string | undefined): string {
  return watchPathsJson ?? binding.watchPathsJson;
}
