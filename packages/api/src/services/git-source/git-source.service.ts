import { createGitSourceConflictError } from '../../errors/api-business-error';
import { isUniqueConstraintError } from '../../queries/query-error';
import {
  disconnectBindingsBySource,
  disconnectSource,
  findActiveSourceByRepository,
  listConnectedSourcesByOrganization,
  updateSourceProviderWebhookId,
} from '../../queries/source.query';
import { cancelNonTerminalSourceResolutionTasksBySource } from '../../queries/source-resolution.query';
import { cancelNonTerminalSourceSyncTasksBySource } from '../../queries/source-sync.query';
import type { SourceMutationTransaction, SourceRow } from '../../queries/source.query.types';
import { getApiDatabase } from '../../runtime/runtime-access';
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
import { connectExistingGitSourceWithProviderHook } from './git-source-existing-connection.service';
import type { GitRepositoryMetadata } from './git-source-provider.types';
import { buildGitSourceSummary, buildGitSourceView } from './git-source-view.service';
import type {
  ConnectGitSourceInput,
  ConnectGitSourceResult,
  DisconnectGitSourceInput,
  GitSourceContextInput,
  GitSourceListItem,
  GitSourceView,
} from './git-source.service.types';
import { queueGitSourceSyncTaskForConnect } from './git-source-sync-task.service';
import {
  connectResolvedProviderHook,
  disconnectSourceProviderHook,
  resolveConnectRepository,
  type ResolvedConnectRepository,
} from './git-source-lifecycle.support';

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
  const resolved: ResolvedConnectRepository = await resolveConnectRepository(input);
  const activeSource: SourceRow | undefined = await findActiveSourceByRepository(
    input.organizationId,
    resolved.providerAccess.registration.providerHost,
    resolved.repository.repositoryExternalId,
  );
  if (activeSource !== undefined) {
    return await connectExistingGitSourceWithProviderHook(input, activeSource, resolved);
  }
  const persisted: SourceRow = await persistConnectedSourceSummary(input, resolved);
  const hooked: SourceRow = await attachProviderHookToSource(persisted, resolved);
  return {
    sourceConnected: true,
    syncRequest: null,
    view: await buildGitSourceView(hooked),
  };
}

export async function disconnectGitSource(input: DisconnectGitSourceInput): Promise<GitSourceView> {
  const source: SourceRow = await requireActiveConnectedSource(input);
  const view: GitSourceView = await buildGitSourceView(source);
  // Provider-hook deletion precedes the transaction so a remote failure leaves the source connected and retryable.
  await disconnectSourceProviderHook(source);
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
  resolved: ResolvedConnectRepository,
): Promise<SourceRow> {
  try {
    return await runPersistConnectedSourceTransaction(input, resolved.repositoryAccess, resolved.repository);
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

async function attachProviderHookToSource(source: SourceRow, resolved: ResolvedConnectRepository): Promise<SourceRow> {
  const hooked: ResolvedConnectRepository = await connectResolvedProviderHook({
    ...resolved,
    hookTarget: {
      providerWebhookId: source.providerWebhookId,
      repositoryExternalId: source.repositoryExternalId,
    },
  });
  return await updateSourceProviderWebhookId(
    getApiDatabase(),
    source.id,
    hooked.repositoryAccess.providerWebhookId,
    new Date(),
  );
}

async function runPersistConnectedSourceTransaction(
  input: ConnectGitSourceInput,
  repositoryAccess: ResolvedRepositoryAccess,
  repository: GitRepositoryMetadata,
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
  repository: GitRepositoryMetadata,
): PersistConnectedGitSourceInput {
  return {
    actorPrincipalId: input.actor.principalId,
    installationId: repositoryAccess.providerInstallationId,
    organizationId: input.organizationId,
    providerHost: repositoryAccess.registration.providerHost,
    providerRegistrationId: repositoryAccess.registration.id,
    providerWebhookId: repositoryAccess.providerWebhookId,
    repository,
    request: input.request,
    syncBranchName: input.request.syncBranchName,
  };
}
