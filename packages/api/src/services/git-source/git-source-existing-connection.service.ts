import { createGitSourceConflictError } from '../../errors/api-business-error';
import { updateSourceToActive } from '../../queries/source.query';
import type { SourceMutationTransaction, SourceRow } from '../../queries/source.query.types';
import { getApiDatabase } from '../../runtime/runtime-access';
import type { GitHubRepositoryMetadata } from './github-app-client.adapter.types';
import { buildUpdateSourceInput } from './git-source-connect.persistence.support';
import { type ResolvedRepositoryAccess } from './git-source-connect.validation';
import { includeGitSourceDescriptorWithinTransaction } from './git-source-exclusion.service';
import {
  readOrCreateGitSourceSyncTaskIdForInclude,
  readOrCreateGitSourceSyncTaskIdForStart,
} from './git-source-sync-task.service';
import type {
  ConnectGitSourceInput,
  ConnectGitSourceResult,
  GitSourceConnectSyncRequestView,
} from './git-source.service.types';
import { requireConnectedSource } from './git-source.service.support';
import { buildGitSourceView } from './git-source-view.service';

interface ExistingSourceConnectMutationResult {
  sourceId: string;
  syncRequest: GitSourceConnectSyncRequestView;
}

export async function connectExistingGitSource(
  input: ConnectGitSourceInput,
  source: SourceRow,
  repositoryAccess: ResolvedRepositoryAccess,
  repository: GitHubRepositoryMetadata,
): Promise<ConnectGitSourceResult> {
  assertExistingSourceMatchesConnectRequest(input, source);
  const mutationResult: ExistingSourceConnectMutationResult = await mutateExistingSourceConnection(
    input,
    source,
    repositoryAccess,
    repository,
  );
  const currentSource: SourceRow = await requireConnectedSource({
    ...input,
    sourceId: mutationResult.sourceId,
  });

  return {
    sourceConnected: false,
    syncRequest: mutationResult.syncRequest,
    view: await buildGitSourceView(currentSource),
  };
}

async function mutateExistingSourceConnection(
  input: ConnectGitSourceInput,
  source: SourceRow,
  repositoryAccess: ResolvedRepositoryAccess,
  repository: GitHubRepositoryMetadata,
): Promise<ExistingSourceConnectMutationResult> {
  let refreshedSource: SourceRow = source;
  const syncRequest: GitSourceConnectSyncRequestView = await getApiDatabase().transaction(
    async (transaction: SourceMutationTransaction): Promise<GitSourceConnectSyncRequestView> => {
      refreshedSource = await refreshExistingSourceProviderMetadata(
        transaction,
        source,
        repositoryAccess,
        repository,
        new Date(),
      );
      return await queueExistingSourceSync(input, transaction, refreshedSource);
    },
  );
  return {
    sourceId: refreshedSource.id,
    syncRequest,
  };
}

function assertExistingSourceMatchesConnectRequest(input: ConnectGitSourceInput, source: SourceRow): void {
  if (hasSameExistingSourceSettings(input, source)) {
    return;
  }

  throw createGitSourceConflictError(
    'This repository is already connected with different branch, environment, or automation settings. Choose the existing source settings.',
  );
}

function hasSameExistingSourceSettings(input: ConnectGitSourceInput, source: SourceRow): boolean {
  return (
    source.autoAdoptNewApps === input.request.autoAdoptNewApps &&
    source.defaultAutoDeployEnabled === input.request.defaultAutoDeployEnabled &&
    source.defaultEnvironmentName === input.request.defaultEnvironmentName &&
    source.syncBranchName === input.request.syncBranchName
  );
}

async function queueExistingSourceSync(
  input: ConnectGitSourceInput,
  transaction: SourceMutationTransaction,
  source: SourceRow,
): Promise<GitSourceConnectSyncRequestView> {
  if (input.request.descriptorPathToInclude !== undefined) {
    return await queueExistingSourceInclude(input, transaction, source, input.request.descriptorPathToInclude);
  }

  return {
    requestedBranchName: source.syncBranchName,
    taskId: await readOrCreateGitSourceSyncTaskIdForStart(transaction, source, input.actor.principalId),
  };
}

async function queueExistingSourceInclude(
  input: ConnectGitSourceInput,
  transaction: SourceMutationTransaction,
  source: SourceRow,
  descriptorPath: string,
): Promise<GitSourceConnectSyncRequestView> {
  await includeGitSourceDescriptorWithinTransaction(transaction, source.id, descriptorPath);
  return {
    descriptorPath,
    requestedBranchName: source.syncBranchName,
    taskId: await readOrCreateGitSourceSyncTaskIdForInclude(
      transaction,
      source,
      descriptorPath,
      input.actor.principalId,
    ),
  };
}

async function refreshExistingSourceProviderMetadata(
  transaction: SourceMutationTransaction,
  source: SourceRow,
  repositoryAccess: ResolvedRepositoryAccess,
  repository: GitHubRepositoryMetadata,
  now: Date,
): Promise<SourceRow> {
  return await updateSourceToActive(
    transaction,
    buildUpdateSourceInput(
      {
        autoAdoptNewApps: source.autoAdoptNewApps,
        defaultAutoDeployEnabled: source.defaultAutoDeployEnabled,
        defaultEnvironmentName: source.defaultEnvironmentName,
        installationId: repositoryAccess.installation.installationId,
        providerHost: source.providerHost,
        providerRegistrationId: repositoryAccess.registration.id,
        repository,
        syncBranchName: source.syncBranchName,
      },
      source.id,
      now,
    ),
  );
}
