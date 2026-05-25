import {
  createGitSourceConflictError,
  createGitSourceRepositoryAccessDeniedError,
} from '../../errors/api-business-error';
import { isUniqueConstraintError } from '../../queries/query-error';
import {
  disconnectBindingsBySource,
  disconnectSource,
  findActiveSourceByRepository,
  listConnectedSourcesByOrganization,
} from '../../queries/source.query';
import { cancelNonTerminalSourceResolutionTasksBySource } from '../../queries/source-resolution.query';
import { cancelNonTerminalSourceSyncTasksBySource } from '../../queries/source-sync.query';
import type { SourceMutationTransaction, SourceRow } from '../../queries/source.query.types';
import type { GitProviderRegistrationRow } from '../../queries/git-provider-registration.query.types';
import { getApiDatabase } from '../../runtime/runtime-access';
import {
  assertGitHubRepositoryBranchExists,
  readGitHubRepositoryMetadata,
  resolveGitHubRepositoryInstallation,
} from './github-app-client.adapter';
import type { GitHubRepositoryInstallation, GitHubRepositoryMetadata } from './github-app-client.adapter.types';
import { type ResolvedRepositoryAccess } from './git-source-connect.validation';
import { persistConnectedGitSource, type PersistConnectedGitSourceInput } from './git-source-connect.persistence';
import {
  blockSourceAutomationPrincipalAccessWithExecutor,
  ensureSourceAutomationPrincipalWithExecutor,
} from './git-source-automation-principal.service';
import {
  readKnownConnectConflictMessage,
  requireActiveConnectedSource,
  requireConnectedSource,
} from './git-source.service.support';
import { connectExistingGitSource } from './git-source-existing-connection.service';
import { buildGitSourceSummary, buildGitSourceView, requireGitProviderField } from './git-source-view.service';
import { requireActiveGitHubProviderAccess, type GitHubProviderAccess } from './git-source-provider-access.service';
import type {
  ConnectGitSourceInput,
  ConnectGitSourceResult,
  DisconnectGitSourceInput,
  GitSourceContextInput,
  GitSourceListItem,
  GitSourceRepositoryRequest,
  GitSourceView,
} from './git-source.service.types';
import { queueGitSourceSyncTaskForConnect } from './git-source-sync-task.service';
import { isGitHubRepositoryAccessFailure } from './github-app-http.adapter';

const disconnectGitSourceFailureReason: string = 'Git source was disconnected.';

export async function listGitSources(input: GitSourceContextInput): Promise<GitSourceListItem[]> {
  return (await listConnectedSourcesByOrganization(input.organizationId)).map(
    (source: SourceRow): GitSourceListItem => ({
      source: buildGitSourceSummary(source),
    }),
  );
}
export async function readGitSource(input: DisconnectGitSourceInput): Promise<GitSourceView> {
  return await buildGitSourceView(await requireConnectedSource(input));
}
export async function connectGitSource(input: ConnectGitSourceInput): Promise<ConnectGitSourceResult> {
  const repositoryAccess: ResolvedRepositoryAccess = await resolveRepositoryAccess(input);
  const repository: GitHubRepositoryMetadata = await readGitHubRepositoryMetadata({
    appId: requireGitProviderField(repositoryAccess.registration.appId, 'app_id'),
    installationId: repositoryAccess.installation.installationId,
    owner: input.request.repositoryOwner,
    privateKeyPem: repositoryAccess.privateKeyPem,
    providerHost: input.request.providerHost,
    repositoryName: input.request.repositoryName,
  });
  await assertSelectedRepositoryBranchExists(input, repositoryAccess);

  const activeSource: SourceRow | undefined = await findActiveSourceByRepository(
    input.organizationId,
    input.request.providerHost,
    repository.repositoryExternalId,
  );
  if (activeSource !== undefined) {
    return await connectExistingGitSource(input, activeSource, repositoryAccess, repository);
  }

  return {
    sourceConnected: true,
    syncRequest: null,
    view: await buildGitSourceView(await persistConnectedSourceSummary(input, repositoryAccess, repository)),
  };
}

async function assertSelectedRepositoryBranchExists(
  input: ConnectGitSourceInput,
  repositoryAccess: ResolvedRepositoryAccess,
): Promise<void> {
  try {
    await assertGitHubRepositoryBranchExists({
      appId: requireGitProviderField(repositoryAccess.registration.appId, 'app_id'),
      branchName: input.request.syncBranchName,
      installationId: repositoryAccess.installation.installationId,
      owner: input.request.repositoryOwner,
      privateKeyPem: repositoryAccess.privateKeyPem,
      providerHost: input.request.providerHost,
      repositoryName: input.request.repositoryName,
    });
  } catch (error) {
    if (isGitHubRepositoryAccessFailure(error instanceof Error ? error : undefined)) {
      throw createGitSourceRepositoryAccessDeniedError('The selected repository branch could not be read.');
    }
    throw error;
  }
}

export async function disconnectGitSource(input: DisconnectGitSourceInput): Promise<GitSourceView> {
  const source: SourceRow = await requireActiveConnectedSource(input);
  const view: GitSourceView = await buildGitSourceView(source);
  await getApiDatabase().transaction(async (transaction: SourceMutationTransaction): Promise<void> => {
    const now: Date = new Date();
    await disconnectBindingsBySource(transaction, source.id, now);
    await cancelNonTerminalSourceResolutionTasksBySource(transaction, {
      completedAt: now,
      failureReason: disconnectGitSourceFailureReason,
      sourceId: source.id,
      updatedAt: now,
    });
    await cancelNonTerminalSourceSyncTasksBySource(transaction, {
      completedAt: now,
      failureReason: disconnectGitSourceFailureReason,
      sourceId: source.id,
      updatedAt: now,
    });
    await blockSourceAutomationPrincipalAccessWithExecutor(transaction, source, now);
    await disconnectSource(transaction, source.id, now);
  });
  return view;
}

async function persistConnectedSourceSummary(
  input: ConnectGitSourceInput,
  repositoryAccess: ResolvedRepositoryAccess,
  repository: GitHubRepositoryMetadata,
): Promise<SourceRow> {
  try {
    return await runPersistConnectedSourceTransaction(input, repositoryAccess, repository);
  } catch (error) {
    const persistedError: Error | undefined = error instanceof Error ? error : undefined;
    if (isUniqueConstraintError(persistedError)) {
      const knownConflictMessage: string | undefined = readKnownConnectConflictMessage(persistedError);
      if (knownConflictMessage !== undefined) {
        throw createGitSourceConflictError(knownConflictMessage);
      }
    }

    throw error;
  }
}

async function runPersistConnectedSourceTransaction(
  input: ConnectGitSourceInput,
  repositoryAccess: ResolvedRepositoryAccess,
  repository: GitHubRepositoryMetadata,
): Promise<SourceRow> {
  return await getApiDatabase().transaction(async (transaction: SourceMutationTransaction): Promise<SourceRow> => {
    const now: Date = new Date();
    const source: SourceRow = await persistConnectedGitSource(
      transaction,
      buildPersistConnectedGitSourceInput(input, repositoryAccess, repository),
      now,
    );
    await ensureSourceAutomationPrincipalWithExecutor(transaction, source);
    await queueGitSourceSyncTaskForConnect(transaction, source, input.actor.principalId);
    return source;
  });
}

function buildPersistConnectedGitSourceInput(
  input: ConnectGitSourceInput,
  repositoryAccess: ResolvedRepositoryAccess,
  repository: GitHubRepositoryMetadata,
): PersistConnectedGitSourceInput {
  return {
    actorPrincipalId: input.actor.principalId,
    installationId: repositoryAccess.installation.installationId,
    organizationId: input.organizationId,
    providerHost: input.request.providerHost,
    providerRegistrationId: repositoryAccess.registration.id,
    repository,
    request: input.request,
    syncBranchName: input.request.syncBranchName,
  };
}

async function resolveRepositoryAccess(input: ConnectGitSourceInput): Promise<ResolvedRepositoryAccess> {
  const providerAccess: GitHubProviderAccess = await requireActiveGitHubProviderAccess(
    input.organizationId,
    input.request.providerHost,
    input.request.repositoryOwner,
  );
  const installation: GitHubRepositoryInstallation = await resolveRepositoryInstallation(
    providerAccess.registration,
    providerAccess.privateKeyPem,
    input.request,
  );

  return {
    installation,
    privateKeyPem: providerAccess.privateKeyPem,
    registration: providerAccess.registration,
  };
}

async function resolveRepositoryInstallation(
  registration: Pick<GitProviderRegistrationRow, 'appId' | 'providerHost'>,
  privateKeyPem: string,
  request: GitSourceRepositoryRequest,
): Promise<GitHubRepositoryInstallation> {
  try {
    return await resolveGitHubRepositoryInstallation({
      appId: requireGitProviderField(registration.appId, 'app_id'),
      owner: request.repositoryOwner,
      privateKeyPem,
      providerHost: registration.providerHost,
      repositoryName: request.repositoryName,
    });
  } catch (error) {
    throw createGitSourceRepositoryAccessDeniedError(error instanceof Error ? error.message : undefined);
  }
}
